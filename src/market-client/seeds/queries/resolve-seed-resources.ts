import { MarketClient } from '../../../entrypoints/clients/market-client.ts';

export type ResolvedSeedResource = {
	key: string;
	kind: 'team' | 'project';
	id: string;
	teamId: string;
	slug: string;
};

export function resolveSeedResourcesMethod(this: MarketClient, keys: string[]) {
	return this.request<{ ok: true; payload: ResolvedSeedResource[] }>('/v1/seeds/resources/resolve', {
		method: 'POST',
		body: { keys },
		requireAuth: true,
	});
}
