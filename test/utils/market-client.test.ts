import { describe, expect, it, vi } from 'vitest';
import { MarketClient } from '../../src/market-client.ts';

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
});
