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

	it('exposes Agent Lab monitoring and target methods through the human control-plane client', async () => {
		const fetchMock = vi.fn(async () => Response.json({ ok: true, payload: {} }));
		const client = new MarketClient({
			profile: { id: 'test', label: 'Test', baseUrl: 'https://market.example.test', kind: 'specialized' },
			accessToken: 'human-token', fetchImpl: fetchMock,
		});
		await client.agentLabOverview('team/a', { date: '2026-08-05' });
		await client.agentLabEntities('team/a', { kind: 'assignments', limit: 20 });
		await client.updateAgentLabTargets('team/a', { targets: { running: 4 } });
		expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
			'https://market.example.test/v1/teams/team%2Fa/agent-lab/overview?date=2026-08-05',
			'https://market.example.test/v1/teams/team%2Fa/agent-lab/entities?kind=assignments&limit=20',
			'https://market.example.test/v1/teams/team%2Fa/agent-lab/targets',
		]);
		expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('PATCH');
	});

	it('routes sovereign control-plane calls away from the singleton Market while keeping Market operations central', async () => {
		const fetchMock = vi.fn(async () => Response.json({ ok: true, payload: {} }));
		const client = new MarketClient({
			profile: { id: 'treeseed', label: 'TreeSeed Market', baseUrl: 'https://api.treeseed.dev', kind: 'central' },
			marketBaseUrl: 'https://api.treeseed.dev',
			controlPlaneBaseUrl: 'https://sovereign.example.test',
			controlPlaneMode: 'external',
			fetchImpl: fetchMock,
		});

		await (client as unknown as { request(path: string): Promise<unknown> }).request('/v1/me');
		await client.currentMarket();

		expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
			'https://sovereign.example.test/v1/me',
			'https://api.treeseed.dev/v1/market/profile',
		]);
	});
});
