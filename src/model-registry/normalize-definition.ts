import path from 'node:path';
import { resolveSdkRepoRoot } from '../runtime.ts';
import { validateModelFieldAliases } from '../sdk-fields.ts';
import { assertResearchCitations } from '../agent-capacity/validation/research-citation.ts';
import type {
	SdkBuiltinModelName,
	SdkGraphModelConfig,
	SdkModelFieldBinding,
	SdkModelDefinition,
	SdkModelName,
	SdkModelRegistry,
} from '../sdk-types.ts';
import { buildBuiltinModelRegistry } from './build-builtin-model-registry.ts';

export function normalizeDefinition(definition: SdkModelDefinition): SdkModelDefinition {
	const normalizedFields = Object.fromEntries(
		Object.entries(definition.fields ?? {}).map(([canonicalKey, binding]) => [
			canonicalKey,
			{
				...binding,
				key: canonicalKey,
				aliases: [...new Set((binding.aliases ?? []).map((alias) => alias.trim().toLowerCase()).filter(Boolean))],
				contentKeys: [...new Set(binding.contentKeys ?? [])],
				dbColumns: [...new Set(binding.dbColumns ?? [])],
				payloadPaths: [...new Set(binding.payloadPaths ?? [])],
			},
		]),
	);

	const normalized = {
		...definition,
		name: definition.name.trim() as SdkModelName,
		aliases: [...new Set((definition.aliases ?? []).map((alias) => alias.trim().toLowerCase()).filter(Boolean))],
		fields: normalizedFields,
		filterableFields: [...new Set(definition.filterableFields ?? Object.entries(normalizedFields).filter(([, binding]) => binding.filterable).map(([key]) => key))],
		sortableFields: [...new Set(definition.sortableFields ?? Object.entries(normalizedFields).filter(([, binding]) => binding.sortable).map(([key]) => key))],
	};
	validateModelFieldAliases(normalized);
	return normalized;
}

export function mergeModelRegistries(
	baseRegistry: SdkModelRegistry,
	definitions: SdkModelDefinition[] = [],
): SdkModelRegistry {
	const registry: SdkModelRegistry = { ...baseRegistry };

	for (const rawDefinition of definitions) {
		const definition = normalizeDefinition(rawDefinition);
		if (!definition.name) {
			throw new Error('SDK model definitions require a non-empty name.');
		}

		registry[definition.name] = definition;
	}

	return registry;
}

export function buildModelRegistry(definitions: SdkModelDefinition[] = []): SdkModelRegistry {
	return mergeModelRegistries(buildBuiltinModelRegistry(), definitions);
}

export function buildScopedModelRegistry(
	repoRoot: string | undefined,
	definitions: SdkModelDefinition[] = [],
) {
	return mergeModelRegistries(buildBuiltinModelRegistry(repoRoot), definitions);
}

export const BUILTIN_MODEL_REGISTRY: SdkModelRegistry = buildBuiltinModelRegistry();

export const MODEL_REGISTRY: SdkModelRegistry = buildModelRegistry();

export function resolveModelDefinition(
	model: string,
	registry: SdkModelRegistry = MODEL_REGISTRY,
): SdkModelDefinition {
	const directMatch = registry[model];
	if (directMatch) {
		return directMatch;
	}

	const normalized = model.trim().toLowerCase();
	const aliasMatch = Object.values(registry).find(
		(definition) => definition.aliases.includes(normalized) || definition.name === normalized,
	);
	if (!aliasMatch) {
		throw new Error(`Unknown SDK model "${model}".`);
	}

	return aliasMatch;
}
