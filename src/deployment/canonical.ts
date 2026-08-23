import { createHash } from 'node:crypto';

function normalized(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalized);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => [key, normalized(entry)]));
}

export function canonicalDeploymentJson(value: unknown) {
	return `${JSON.stringify(normalized(value))}\n`;
}

export function deploymentDigest(value: unknown) {
	return `sha256:${createHash('sha256').update(canonicalDeploymentJson(value)).digest('hex')}`;
}
