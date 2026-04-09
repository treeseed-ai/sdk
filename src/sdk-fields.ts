import {
	resolveAliasedField,
	type TreeseedFieldAliasRegistry,
} from './field-aliases.ts';
import type {
	SdkModelDefinition,
	SdkModelFieldBinding,
	SdkSortSpec,
	SdkFilterCondition,
} from './sdk-types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeFieldName(value: string) {
	return value.trim().toLowerCase();
}

function readPathValue(source: Record<string, unknown>, path: string) {
	const normalizedPath = path.replace(/^\$\.?/u, '');
	if (!normalizedPath) {
		return undefined;
	}

	return normalizedPath.split('.').reduce<unknown>((current, segment) => {
		if (!isRecord(current)) {
			return undefined;
		}
		return current[segment];
	}, source);
}

function readCandidateValue(record: Record<string, unknown>, candidate: string) {
	if (candidate in record) {
		return record[candidate];
	}

	if (isRecord(record.frontmatter) && candidate in record.frontmatter) {
		return record.frontmatter[candidate];
	}

	return readPathValue(record, candidate);
}

function normalizeFieldBinding(binding: SdkModelFieldBinding, canonicalKey: string): SdkModelFieldBinding {
	const aliases = [...new Set((binding.aliases ?? []).map(normalizeFieldName).filter(Boolean))];
	const contentKeys = [...new Set((binding.contentKeys ?? []).filter(Boolean))];
	const dbColumns = [...new Set((binding.dbColumns ?? []).filter(Boolean))];
	const payloadPaths = [...new Set((binding.payloadPaths ?? []).filter(Boolean))];

	return {
		...binding,
		key: canonicalKey,
		aliases,
		contentKeys,
		dbColumns,
		payloadPaths,
	};
}

export function validateModelFieldAliases(definition: SdkModelDefinition) {
	const seen = new Map<string, string>();

	for (const [canonicalKey, rawBinding] of Object.entries(definition.fields ?? {})) {
		if (!canonicalKey.trim()) {
			throw new Error(`Model "${definition.name}" includes an empty canonical field key.`);
		}

		const binding = normalizeFieldBinding(rawBinding, canonicalKey);
		for (const candidate of [canonicalKey, ...(binding.aliases ?? [])]) {
			const normalized = normalizeFieldName(candidate);
			const owner = seen.get(normalized);
			if (owner && owner !== canonicalKey) {
				throw new Error(
					`Model "${definition.name}" reuses field alias "${candidate}" for both "${owner}" and "${canonicalKey}".`,
				);
			}
			seen.set(normalized, canonicalKey);
		}
	}

	if (!(definition.pickField in (definition.fields ?? {}))) {
		throw new Error(`Model "${definition.name}" pickField "${definition.pickField}" does not reference a defined field.`);
	}

	for (const fieldName of definition.filterableFields ?? []) {
		if (!(fieldName in (definition.fields ?? {}))) {
			throw new Error(`Model "${definition.name}" filterable field "${fieldName}" is not defined in fields.`);
		}
	}

	for (const fieldName of definition.sortableFields ?? []) {
		if (!(fieldName in (definition.fields ?? {}))) {
			throw new Error(`Model "${definition.name}" sortable field "${fieldName}" is not defined in fields.`);
		}
	}
}

export function resolveModelField(definition: SdkModelDefinition, requestedField: string): SdkModelFieldBinding {
	const registry = Object.fromEntries(
		Object.entries(definition.fields ?? {}).map(([canonicalKey, rawBinding]) => [
			canonicalKey,
			normalizeFieldBinding(rawBinding, canonicalKey),
		]),
	) as TreeseedFieldAliasRegistry<SdkModelFieldBinding>;
	return resolveAliasedField(registry, requestedField);
}

export function readCanonicalFieldValue(
	definition: SdkModelDefinition,
	record: Record<string, unknown>,
	canonicalField: string,
) {
	const binding = resolveModelField(definition, canonicalField);
	for (const candidate of [
		binding.key,
		...(binding.contentKeys ?? []),
		...(binding.dbColumns ?? []),
		...(binding.payloadPaths ?? []),
		...(binding.aliases ?? []),
	]) {
		const value = readCandidateValue(record, candidate);
		if (value !== undefined) {
			return binding.normalize ? binding.normalize(value) : value;
		}
	}

	return undefined;
}

export function normalizeRecordToCanonicalShape(
	definition: SdkModelDefinition,
	record: Record<string, unknown>,
): Record<string, unknown> {
	const normalized = { ...record };
	for (const canonicalField of Object.keys(definition.fields ?? {})) {
		const value = readCanonicalFieldValue(definition, record, canonicalField);
		if (value !== undefined) {
			normalized[canonicalField] = value;
		}
	}
	return normalized;
}

export function normalizeMutationData(
	definition: SdkModelDefinition,
	data: Record<string, unknown>,
): Record<string, unknown> {
	const next = { ...data };
	for (const key of Object.keys(data)) {
		const binding = resolveModelField(definition, key);
		next[binding.key] = binding.normalize ? binding.normalize(data[key]) : data[key];
		if (binding.key !== key) {
			delete next[key];
		}
	}
	return next;
}

export function canonicalizeFrontmatter(
	definition: SdkModelDefinition,
	frontmatter: Record<string, unknown>,
	updates: Record<string, unknown> = {},
) {
	const normalizedExisting = normalizeRecordToCanonicalShape(definition, frontmatter);
	const normalizedUpdates = normalizeMutationData(definition, updates);
	const next = { ...frontmatter };

	for (const [canonicalField, value] of Object.entries({ ...normalizedExisting, ...normalizedUpdates })) {
		const binding = definition.fields[canonicalField];
		if (!binding) {
			continue;
		}
		const writeKey = binding.writeContentKey ?? binding.contentKeys?.[0] ?? canonicalField;
		for (const key of [binding.key, ...(binding.contentKeys ?? []), ...(binding.aliases ?? [])]) {
			if (key !== writeKey) {
				delete next[key];
			}
		}
		next[writeKey] = value;
	}

	return next;
}

export function normalizeFilterFields(
	definition: SdkModelDefinition,
	filters: SdkFilterCondition[] = [],
): SdkFilterCondition[] {
	return filters.map((filter) => {
		const binding = resolveModelField(definition, filter.field);
		return {
			...filter,
			field: binding.key,
		};
	});
}

export function normalizeSortFields(
	definition: SdkModelDefinition,
	sort: SdkSortSpec[] = [],
): SdkSortSpec[] {
	return sort.map((entry) => {
		const binding = resolveModelField(definition, entry.field);
		return {
			...entry,
			field: binding.key,
		};
	});
}
