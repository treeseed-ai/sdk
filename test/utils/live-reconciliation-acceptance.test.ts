import { describe, expect, it, vi } from 'vitest';
import {
	runTreeseedLiveReconcileTests,
	treeseedLiveReconcileResourcePrefix,
} from '../../src/reconcile/index.ts';

describe('live reconciliation acceptance harness', () => {
	it('keeps smoke mode read-only and canonical', async () => {
		const result = await runTreeseedLiveReconcileTests({
			cwd: process.cwd(),
			environment: 'staging',
			mode: 'smoke',
			providers: ['local'],
			now: new Date('2026-06-08T12:00:00Z'),
		});

		expect(result.ok).toBe(true);
		expect(result.mode).toBe('smoke');
		expect(result.providers[0]?.report.actions.every((action) => action.kind === 'noop')).toBe(true);
		expect(result.providers[0]?.report.blockedDrift).toEqual([]);
	});

	it('blocks Railway acceptance before mutation when disposable domain config is missing', async () => {
		const result = await runTreeseedLiveReconcileTests({
			cwd: process.cwd(),
			environment: 'staging',
			mode: 'acceptance',
			providers: ['railway'],
			env: {
				TREESEED_RAILWAY_API_TOKEN: 'token',
			},
			now: new Date('2026-06-08T12:00:00Z'),
		});

		expect(result.ok).toBe(false);
		const railway = result.providers[0];
		expect(railway?.provider).toBe('railway');
		expect(railway?.createdResources).toEqual([]);
		expect(railway?.report.blockedDrift.map((entry) => entry.reason).join(' ')).toMatch(/TREESEED_LIVE_TEST_DOMAIN/u);
	});

	it('uses one deterministic Railway project identity for the provider run', async () => {
		const runId = '20260608120000';
		const prefix = treeseedLiveReconcileResourcePrefix('staging', 'railway', runId);
		const result = await runTreeseedLiveReconcileTests({
			cwd: process.cwd(),
			environment: 'staging',
			mode: 'acceptance',
			providers: ['railway'],
			env: {
				TREESEED_RAILWAY_API_TOKEN: 'token',
			},
			runId,
		});
		const railway = result.providers[0];
		const projectNodes = railway?.report.desiredGraph.filter((node) => node.provider === 'railway' && node.type === 'project') ?? [];

		expect(prefix).toBe('trsd-rail-20260608120000');
		expect(railway?.resourcePrefix).toBe(prefix);
		expect(projectNodes).toHaveLength(1);
		expect(railway?.scenarioResults.map((entry) => entry.capability)).toContain('project');
	});

	it('runs local capacity assignment proof through the public market clients when configured', async () => {
		const runId = '20260608120000';
		const prefix = treeseedLiveReconcileResourcePrefix('local', 'local', runId);
		const assignmentId = `${prefix}-assignment`;
		const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			const method = init?.method ?? 'GET';
			const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
			calls.push({ method, path: url.pathname, body });
			if (method === 'POST' && url.pathname === '/v1/provider/check-in') {
				return Response.json({ ok: true, payload: { id: `${prefix}-session`, capacityProviderId: 'provider_123', status: 'open' } });
			}
			if (method === 'POST' && url.pathname === '/v1/teams/team_123/capacity/assignments') {
				return Response.json({ ok: true, payload: { id: assignmentId, status: 'pending' } }, { status: 201 });
			}
			if (method === 'POST' && url.pathname === '/v1/provider/assignments/next') {
				return Response.json({ ok: true, payload: { id: assignmentId, status: 'leased', leaseState: 'leased' }, leaseToken: 'lease_123' });
			}
			if (method === 'POST' && url.pathname === `/v1/provider/assignments/${assignmentId}/mode-runs`) {
				return Response.json({ ok: true, payload: { id: 'mode_run_123', providerAssignmentId: assignmentId, status: 'succeeded' } }, { status: 201 });
			}
			if (method === 'POST' && url.pathname === `/v1/provider/assignments/${assignmentId}/complete`) {
				return Response.json({ ok: true, payload: { id: assignmentId, status: 'completed', leaseState: 'released' } });
			}
			if (method === 'GET' && url.pathname === '/v1/projects/project_123/agent-mode-runs') {
				expect(url.searchParams.get('assignmentId')).toBe(assignmentId);
				return Response.json({ ok: true, payload: [{ id: 'mode_run_123', providerAssignmentId: assignmentId }] });
			}
			return Response.json({ error: `Unexpected request: ${method} ${url.pathname}` }, { status: 404 });
		}) as unknown as typeof fetch;

		const result = await runTreeseedLiveReconcileTests({
			cwd: process.cwd(),
			environment: 'local',
			mode: 'acceptance',
			providers: ['local'],
			env: {
				TREESEED_CAPACITY_ACCEPTANCE_API_URL: 'https://market.example.test',
				TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN: 'admin-token',
				TREESEED_CAPACITY_ACCEPTANCE_TEAM_ID: 'team_123',
				TREESEED_CAPACITY_ACCEPTANCE_PROJECT_ID: 'project_123',
				TREESEED_CAPACITY_ACCEPTANCE_PROVIDER_ID: 'provider_123',
				TREESEED_CAPACITY_ACCEPTANCE_AGENT_CLASS_ID: 'agent_class_123',
				TREESEED_CAPACITY_PROVIDER_API_KEY: 'provider-key',
			},
			runId,
			fetchImpl,
		});
		const local = result.providers[0];
		const proof = local?.scenarioResults.find((entry) => entry.capability === 'capacity-provider-assignment-proof');

		expect(proof?.ok).toBe(true);
		expect(proof?.retainedResources[0]).toMatchObject({
			id: assignmentId,
			type: 'capacity-runtime-proof',
			state: {
				sessionId: `${prefix}-session`,
				modeRunId: 'mode_run_123',
				finalStatus: 'completed',
			},
		});
		expect(calls.map((call) => `${call.method} ${call.path}`)).toContain('POST /v1/provider/assignments/next');
		expect(result.ok).toBe(true);
	});

	it('cleans stale Cloudflare live-test Pages projects without deleting the static project', async () => {
		const deleted: string[] = [];
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url.includes('/workers/services')) return Response.json({ success: true, result: [] });
			if (url.includes('/pages/projects?')) {
				return Response.json({
					success: true,
					result: [
						{ name: 'treeseed-market' },
						{ name: 'trsd-live-staging-cloudflare-20260609010218' },
						{ name: 'trsd-live-prod-cloudflare-20260609010218' },
					],
				});
			}
			if (method === 'DELETE' && url.includes('/pages/projects/')) {
				deleted.push(decodeURIComponent(url.split('/pages/projects/')[1] ?? ''));
				return Response.json({ success: true, result: null });
			}
			if (url.includes('/r2/buckets')) return Response.json({ success: true, result: { buckets: [] } });
			if (url.includes('/storage/kv/namespaces')) return Response.json({ success: true, result: [] });
			if (url.includes('/d1/database')) return Response.json({ success: true, result: [] });
			if (url.includes('/queues')) return Response.json({ success: true, result: { queues: [] } });
			if (url.includes('/challenges/widgets')) return Response.json({ success: true, result: [] });
			if (url.includes('/dns_records')) return Response.json({ success: true, result: [] });
			throw new Error(`Unexpected Cloudflare request: ${method} ${url}`);
		}) as unknown as typeof fetch;

		const result = await runTreeseedLiveReconcileTests({
			cwd: process.cwd(),
			environment: 'staging',
			mode: 'cleanup',
			providers: ['cloudflare'],
			env: {
				TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-id',
				TREESEED_CLOUDFLARE_API_TOKEN: 'token',
				CLOUDFLARE_ZONE_ID: 'zone-id',
				TREESEED_LIVE_TEST_DOMAIN: 'example.com',
			},
			runId: '20260609120000',
			fetchImpl,
		});

		expect(result.ok).toBe(true);
		expect(deleted).toEqual(['trsd-live-staging-cloudflare-20260609010218']);
		expect(result.providers[0]?.destroyedResources.map((entry) => entry.id)).toContain('trsd-live-staging-cloudflare-20260609010218');
	});
});
