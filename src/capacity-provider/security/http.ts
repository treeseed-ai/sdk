function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildCapacityProviderAuthHeaders(accessToken: string) {
	const trimmed = accessToken.trim();
	if (!trimmed) throw new Error('Capacity provider membership access token is required.');
	return { authorization: `Bearer ${trimmed}` };
}

export function assertCapacityProviderOkEnvelope(value: unknown, label = 'Capacity provider response'): asserts value is { ok: true } {
	if (!isRecord(value) || value.ok !== true) throw new Error(`${label} must be an ok response envelope.`);
}
