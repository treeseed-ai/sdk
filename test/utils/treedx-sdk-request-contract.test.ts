import { describe, expect, it, vi } from 'vitest';
import { TREEDX_CLIENT_OPERATION_MAP, TreeDxClient } from '../../src/treedx/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('TreeDX SDK request contract', () => {
	it('maps public client methods to OpenAPI operation ids', () => {
		expect(TREEDX_CLIENT_OPERATION_MAP).toMatchObject({
			whoami: 'getWhoami',
			ready: 'getReadiness',
			deepHealth: 'getDeepHealth',
			adminDeepHealth: 'getAdminDeepHealth',
			metrics: 'getMetrics',
			prometheusMetrics: 'getPrometheusMetrics',
			getRepository: 'getRepository',
			createWorkspace: 'createWorkspace',
			writeBlob: 'writeWorkspaceBlob',
			federatedSearch: 'federatedSearch',
		});
	});

	it('constructs representative requests with documented methods, paths, auth, and bodies', async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), init: init ?? {} });
			if (String(input).endsWith('/auth/whoami')) {
				return json({ ok: true, authenticated: true, principal: { actorId: 'actor', tenantId: 'tenant' } });
			}
			if (String(input).endsWith('/ready')) {
				return json({ ok: true, readiness: { status: 'ready', checks: [], checkedAt: '2026-06-03T12:00:00Z' } });
			}
			if (String(input).endsWith('/health/deep')) {
				return json({ ok: true, health: { status: 'healthy', checks: [], checkedAt: '2026-06-03T12:00:00Z' } });
			}
			if (String(input).endsWith('/api/v1/metrics')) {
				return json({ ok: true, metrics: { counters: [], histograms: [], gauges: [] } });
			}
			if (String(input).endsWith('/metrics')) {
				return new Response('treedx_http_requests_total 1\n', { status: 200 });
			}
			if (String(input).endsWith('/repos/repo_1')) {
				return json({ ok: true, repo: { repoId: 'repo_1', name: 'docs', defaultRef: 'refs/heads/main', status: 'ready' } });
			}
			if (String(input).endsWith('/repos/repo_1/workspaces')) {
				return json({ ok: true, workspace: { workspaceId: 'ws_1', repoId: 'repo_1', baseRef: 'refs/heads/main', baseCommitSha: 'abc', mode: 'writable', status: 'ready' } });
			}
			if (String(input).endsWith('/workspaces/ws_1/blobs/write')) {
				return json({ ok: true, result: { workspaceId: 'ws_1', path: 'assets/logo.png', op: 'put' } });
			}
			if (String(input).endsWith('/search')) {
				return json({ ok: true, search: { query: 'release', results: [], page: { limit: 20, hasMore: false }, diagnostics: { requestedRepoCount: 1, executedRepoCount: 1, rejectedRepoCount: 0, partialFailureCount: 0, routing: [] }, errors: [] } });
			}
			return json({ ok: true });
		});
		const client = new TreeDxClient({ baseUrl: 'https://treedx.example.test', token: 'token', repoId: 'repo_1', fetch: fetchMock as typeof fetch });

		await client.whoami();
		await client.ready();
		await client.deepHealth();
		await client.metrics();
		await client.prometheusMetrics();
		await client.getRepository();
		await client.createWorkspace({ baseRef: 'refs/heads/main', mode: 'writable' });
		await client.writeBlob({ workspaceId: 'ws_1', path: 'assets/logo.png', encoding: 'base64', contentBase64: 'AA==' });
		await client.federatedSearch({ repoIds: ['repo_1'], query: 'release' });

		expect(calls.map((call) => [call.init.method, call.url])).toEqual([
			['GET', 'https://treedx.example.test/api/v1/auth/whoami'],
			['GET', 'https://treedx.example.test/api/v1/ready'],
			['GET', 'https://treedx.example.test/api/v1/health/deep'],
			['GET', 'https://treedx.example.test/api/v1/metrics'],
			['GET', 'https://treedx.example.test/metrics'],
			['GET', 'https://treedx.example.test/api/v1/repos/repo_1'],
			['POST', 'https://treedx.example.test/api/v1/repos/repo_1/workspaces'],
			['POST', 'https://treedx.example.test/api/v1/workspaces/ws_1/blobs/write'],
			['POST', 'https://treedx.example.test/api/v1/search'],
		]);
		expect(calls.slice(0, 8).every((call) => (call.init.headers as Record<string, string>).authorization === 'Bearer token' || call.url.endsWith('/metrics'))).toBe(true);
		expect(JSON.parse(String(calls[6]?.init.body))).toMatchObject({ baseRef: 'refs/heads/main', mode: 'writable' });
		expect(JSON.parse(String(calls[7]?.init.body))).toMatchObject({ path: 'assets/logo.png', encoding: 'base64', contentBase64: 'AA==' });
		expect(JSON.parse(String(calls[8]?.init.body))).toMatchObject({ repoIds: ['repo_1'], query: 'release' });
	});
});
