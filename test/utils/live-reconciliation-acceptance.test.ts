import { describe, expect, it } from 'vitest';
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
});
