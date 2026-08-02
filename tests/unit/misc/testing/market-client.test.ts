import { describe, expect, it, vi } from 'vitest';
import { MarketClient } from '../../../../src/entrypoints/clients/market-client.ts';

describe('MarketClient human control-plane transport', () => {
	it('queries team-scoped capacity audit events through the human control-plane client', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			ok: true,
			payload: { items: [], page: { limit: 25, hasMore: false, nextCursor: null } },
		}), { status: 200, headers: { 'content-type': 'application/json' } }));
		const client = new MarketClient({
			profile: { id: 'test', label: 'Test', baseUrl: 'https://market.example.test', kind: 'specialized' },
			accessToken: 'human-token',
			fetchImpl: fetchMock,
		});
		await client.capacityAuditEvents('team-a', { action: 'membership.suspended', providerId: 'provider-a', limit: 25 });
		const [url] = fetchMock.mock.calls[0] ?? [];
		expect(String(url)).toBe('https://market.example.test/v1/teams/team-a/capacity-audit-events?action=membership.suspended&providerId=provider-a&limit=25');
	});
});
