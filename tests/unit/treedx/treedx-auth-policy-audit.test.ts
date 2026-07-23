import { describe, expect, it, vi } from 'vitest';
import { TreeDxApiError, TreeDxClient } from '../../../src/treedx/index.ts';

function json(payload: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => payload,
	} as Response;
}

describe('TreeDX auth policy and audit client methods', () => {
	it('calls auth mode, capabilities, grants, audit, and federation planner endpoints', async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			calls.push({ url, init });
			if (url.endsWith('/auth/mode')) return json({ ok: true, mode: 'dev', connected: false });
			if (url.endsWith('/policy/capabilities')) return json({ ok: true, capabilities: ['files:read'] });
			if (url.includes('/policy/grants') && init?.method === 'POST') {
				return json({ ok: true, grant: { actorId: 'actor_a', tenantId: 'tenant_a', repoIds: ['repo_a'], capabilities: [], refs: [], paths: [] } });
			}
			if (url.includes('/policy/grants')) return json({ ok: true, grants: [] });
			if (url.includes('/audit/events')) return json({ ok: true, events: [], page: { limit: 100, hasMore: false } });
			if (url.endsWith('/federation/query/plan')) {
				return json({ ok: true, requestedScope: {}, effectiveScope: { repos: [] }, rejected: [], executable: false, reason: 'planner_only_mvp' });
			}
			return json({ ok: true });
		});
		const client = new TreeDxClient({ baseUrl: 'https://treedx.example.test', token: 'token', fetch: fetchMock });

		expect(await client.authMode()).toMatchObject({ mode: 'dev' });
		expect(await client.listCapabilities()).toMatchObject({ capabilities: ['files:read'] });
		await client.putCapabilityGrant({ actorId: 'actor_a', tenantId: 'tenant_a', repoIds: ['repo_a'], capabilities: [], refs: [], paths: [] });
		await client.listCapabilityGrants({ actorId: 'actor_a', repoId: 'repo_a' });
		await client.listAuditEvents({ repoId: 'repo_a', eventType: 'file.written', limit: 10 });
		await client.planFederatedQuery({ repoIds: ['repo_a'], capabilities: ['files:search'] });

		expect(calls.map((call) => call.url)).toContain('https://treedx.example.test/api/v1/auth/mode');
		expect(calls.some((call) => call.url.includes('/policy/grants?actorId=actor_a&repoId=repo_a'))).toBe(true);
		expect(calls.some((call) => call.url.includes('/audit/events?repoId=repo_a&eventType=file.written&limit=10'))).toBe(true);
		expect(calls.find((call) => call.url.endsWith('/policy/grants') && call.init?.method === 'POST')?.init?.headers).toMatchObject({
			authorization: 'Bearer token',
		});
	});

	it('preserves connected auth and capability errors', async () => {
		const client = new TreeDxClient({
			baseUrl: 'https://treedx.example.test',
			token: 'bad',
			fetch: vi.fn(async () => json({ ok: false, error: { code: 'invalid_signature', message: 'Invalid bearer token signature.' } }, 401)),
		});

		await expect(client.listCapabilities()).rejects.toMatchObject<TreeDxApiError>({
			status: 401,
			code: 'invalid_signature',
		});
	});
});
