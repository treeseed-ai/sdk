export interface FieldAliasBinding {
	key: string;
	aliases?: string[];
	normalize?: (value: unknown) => unknown;
}

export type FieldAliasRegistry<TBinding extends FieldAliasBinding = FieldAliasBinding> = Record<
	string,
	TBinding
>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeFieldName(value: string) {
	return value.trim().toLowerCase();
}

export function resolveAliasedField<TBinding extends FieldAliasBinding>(
	registry: FieldAliasRegistry<TBinding>,
	requestedField: string,
): TBinding {
	const normalizedRequested = normalizeFieldName(requestedField);
	for (const [canonicalKey, binding] of Object.entries(registry)) {
		const aliases = (binding.aliases ?? []).map(normalizeFieldName);
		if (normalizeFieldName(canonicalKey) === normalizedRequested || aliases.includes(normalizedRequested)) {
			return { ...binding, key: canonicalKey };
		}
	}

	throw new Error(`Unknown aliased field "${requestedField}".`);
}

export function normalizeAliasedRecord<TBinding extends FieldAliasBinding>(
	registry: FieldAliasRegistry<TBinding>,
	source: Record<string, unknown>,
) {
	if (!isRecord(source)) {
		return source;
	}

	const next = { ...source };
	for (const [canonicalKey, binding] of Object.entries(registry)) {
		for (const candidate of [canonicalKey, ...(binding.aliases ?? [])]) {
			if (!(candidate in source)) {
				continue;
			}

			const value = source[candidate];
			next[canonicalKey] = typeof binding.normalize === 'function' ? binding.normalize(value) : value;
			break;
		}
	}

	return next;
}

export function preprocessAliasedRecord<TBinding extends FieldAliasBinding>(
	registry: FieldAliasRegistry<TBinding>,
	value: unknown,
) {
	return isRecord(value) ? normalizeAliasedRecord(registry, value) : value;
}
