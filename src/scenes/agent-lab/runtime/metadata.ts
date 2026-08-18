import type { MarketClient } from '../../../entrypoints/clients/market-client.ts';

type Row = Record<string, unknown>;

function record(value: unknown): Row {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function resolveAgentLabInitiator(client: MarketClient) {
	const response = await client.request<Row>('/v1/me', { requireAuth: true });
	const principal = record(record(response.payload).principal);
	return {
		id: text(principal.id),
		email: text(principal.email),
		displayName: text(principal.displayName ?? principal.name),
		type: text(principal.type),
	};
}
