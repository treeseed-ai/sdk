import { StandardsError } from './errors.ts';
import type { StandardsDigest, StandardsFingerprint } from './contracts.ts';

type JsonPrimitive = boolean | number | string | null;
export type CanonicalJsonValue = JsonPrimitive | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

function canonicalValue(value: unknown, seen: Set<object>, path: string): CanonicalJsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new StandardsError('standards_invalid_digest_input', 'Canonical JSON does not accept non-finite numbers.', path);
		return Object.is(value, -0) ? 0 : value;
	}
	if (typeof value !== 'object') {
		throw new StandardsError('standards_invalid_digest_input', `Canonical JSON does not accept ${typeof value}.`, path);
	}
	if (seen.has(value)) throw new StandardsError('standards_invalid_digest_input', 'Canonical JSON does not accept cyclic values.', path);
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map((entry, index) => canonicalValue(entry, seen, `${path}[${index}]`));
		}
		const record = value as Record<string, unknown>;
		return Object.fromEntries(Object.keys(record).filter((key) => record[key] !== undefined).sort()
			.map((key) => [key, canonicalValue(record[key], seen, `${path}.${key}`)]));
	} finally {
		seen.delete(value);
	}
}

export function canonicalizeStandardsValue(value: unknown): CanonicalJsonValue {
	return canonicalValue(value, new Set(), '$');
}

export function canonicalStandardsJson(value: unknown): string {
	return JSON.stringify(canonicalizeStandardsValue(value));
}

export async function standardsSha256(value: unknown): Promise<StandardsDigest> {
	const bytes = new TextEncoder().encode(canonicalStandardsJson(value));
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	const hex = Array.from(new Uint8Array(digest), (entry) => entry.toString(16).padStart(2, '0')).join('');
	return `sha256:${hex}`;
}

export async function fingerprintStandardsValue(value: unknown): Promise<StandardsFingerprint> {
	return { algorithm: 'sha256', digest: await standardsSha256(value) };
}
