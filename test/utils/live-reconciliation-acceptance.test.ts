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
				RAILWAY_API_TOKEN: 'token',
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
				RAILWAY_API_TOKEN: 'token',
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
				CLOUDFLARE_ACCOUNT_ID: 'account-id',
				CLOUDFLARE_API_TOKEN: 'token',
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
