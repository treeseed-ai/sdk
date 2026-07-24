import { describe, expect, it, vi } from 'vitest';
import { MarketClient } from '../../../../src/entrypoints/clients/market-client.ts';

describe('MarketClient human control-plane transport', () => {
	it('owns project connection mutation with authenticated contract headers', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			ok: true,
			payload: {
				connection: { id: 'connection-1', projectId: 'project-1', mode: 'hybrid', executionOwner: 'project_runner' },
				runnerToken: 'runner-token-once',
			},
		}), { status: 200, headers: { 'content-type': 'application/json' } }));
		const client = new MarketClient({
			profile: { id: 'test', label: 'Test', baseUrl: 'https://market.example.test', kind: 'specialized' },
			accessToken: 'human-token',
			fetchImpl: fetchMock,
		});
		const result = await client.upsertProjectConnection('project-1', {
			mode: 'hybrid',
			executionOwner: 'project_runner',
			rotateRunnerToken: true,
		});
		expect(result.payload).toMatchObject({ connection: { projectId: 'project-1' }, runnerToken: 'runner-token-once' });
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(String(url)).toBe('https://market.example.test/v1/projects/project-1/connection');
		expect(init?.method).toBe('POST');
		expect(new Headers(init?.headers).get('authorization')).toBe('Bearer human-token');
		expect(new Headers(init?.headers).get('x-treeseed-remote-contract-version')).toBeTruthy();
	});

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
