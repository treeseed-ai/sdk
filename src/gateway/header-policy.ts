const HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
]);

export const FORBIDDEN_INTERNAL_HEADERS = new Set([
	'x-treeseed-market-database-url',
	'x-treeseed-market-service-secret',
	'x-treeseed-internal-secret',
]);

function connectionHeaders(headers: Headers) {
	return new Set((headers.get('connection') ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export function sanitizedGatewayHeaders(source: Headers, forbidden: Set<string> = new Set()) {
	const connectionSpecific = connectionHeaders(source);
	const result = new Headers();
	for (const [name, value] of source) {
		const normalized = name.toLowerCase();
		if (HOP_BY_HOP_HEADERS.has(normalized) || connectionSpecific.has(normalized) || forbidden.has(normalized)) continue;
		if (normalized !== 'set-cookie') result.append(name, value);
	}
	const getSetCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie;
	for (const cookie of getSetCookie?.call(source) ?? []) result.append('set-cookie', cookie);
	return result;
}

export function isForbiddenGatewayHeader(name: string) {
	return FORBIDDEN_INTERNAL_HEADERS.has(name.toLowerCase());
}
