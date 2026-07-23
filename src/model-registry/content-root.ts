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


export function contentRoot(repoRoot?: string) {
	return process.env.TREESEED_AGENT_CONTENT_ROOT
		? path.resolve(process.env.TREESEED_AGENT_CONTENT_ROOT)
		: path.resolve(resolveSdkRepoRoot(repoRoot), 'src', 'content');
}

export function field(
	key: string,
	options: Omit<SdkModelFieldBinding, 'key'> = {},
): SdkModelFieldBinding {
	return { key, ...options };
}

export function citationsField() {
	return field('citations', {
		contentKeys: ['citations'],
		writeContentKey: 'citations',
		normalize: (value) => assertResearchCitations(value),
	});
}

export function deriveFieldLists(fields: Record<string, SdkModelFieldBinding>) {
	const entries = Object.entries(fields);
	return {
		filterableFields: entries.filter(([, binding]) => binding.filterable).map(([key]) => key),
		sortableFields: entries.filter(([, binding]) => binding.sortable).map(([key]) => key),
	};
}

export function graph(config: SdkGraphModelConfig): SdkGraphModelConfig {
	return config;
}
