import { describe, expect, it } from 'vitest';
import {
	assertTreeseedCanonicalReconcileSuccess,
	createTreeseedCanonicalReconcileReport,
	TREESEED_RECONCILE_ACTION_KINDS,
	TREESEED_RECONCILE_RUN_MODEL,
} from '../../../src/reconcile/index.ts';

describe('canonical reconciliation platform', () => {
	it('defines the required Terraform-style lifecycle and action vocabulary', () => {
		expect(TREESEED_RECONCILE_RUN_MODEL).toEqual([
			'refresh',
			'plan',
			'validate',
			'apply',
			'refresh',
			'verify',
			'persist',
		]);
		expect(TREESEED_RECONCILE_ACTION_KINDS).toEqual([
			'noop',
			'create',
			'update',
			'replace',
			'delete',
			'adopt',
			'rename',
			'reattach',
			'retain',
			'taint',
			'blocked',
		]);
	});

	it('emits every canonical report field', () => {
		const report = createTreeseedCanonicalReconcileReport({
			desiredGraph: [{ id: 'api:railway-service', provider: 'railway', type: 'service' }],
			observedGraph: [{ id: 'api:railway-service', provider: 'railway', type: 'service', state: { ready: true } }],
			postconditions: [{
				id: 'api:railway-service:http',
				resourceId: 'api:railway-service',
				description: 'API HTTP health passes.',
				source: 'http',
				required: true,
				ok: true,
				issues: [],
			}],
			liveVerification: { ok: true, source: 'test', issues: [] },
		});
		expect(Object.keys(report)).toEqual([
			'desiredGraph',
			'observedGraph',
			'stateGraph',
			'diff',
			'actions',
			'postconditions',
			'selectedResources',
			'skippedResources',
			'blockedDrift',
			'providerLimitations',
			'retainedResources',
			'destroyedResources',
			'liveVerification',
			'ok',
		]);
		expect(report.ok).toBe(true);
		expect(() => assertTreeseedCanonicalReconcileSuccess(report)).not.toThrow();
	});

	it('fails when blocking drift remains', () => {
		const report = createTreeseedCanonicalReconcileReport({
			desiredGraph: [{ id: 'api:runner-volume', provider: 'railway', type: 'volume' }],
			diff: [{
				id: 'api:runner-volume:missing',
				resourceId: 'api:runner-volume',
				severity: 'blocking',
				reason: 'Operations runner volume is missing.',
			}],
			liveVerification: { ok: true, issues: [] },
		});
		expect(report.ok).toBe(false);
		expect(() => assertTreeseedCanonicalReconcileSuccess(report)).toThrow(/Operations runner volume is missing/u);
	});

	it('fails when required live postconditions do not pass', () => {
		const report = createTreeseedCanonicalReconcileReport({
			desiredGraph: [{ id: 'api:http-health', provider: 'railway', type: 'domain' }],
			postconditions: [{
				id: 'api:http-health:200',
				resourceId: 'api:http-health',
				description: 'API health returns HTTP 200.',
				source: 'http',
				required: true,
				ok: false,
				issues: ['HTTP health returned 502.'],
			}],
			liveVerification: { ok: true, issues: [] },
		});
		expect(report.ok).toBe(false);
		expect(() => assertTreeseedCanonicalReconcileSuccess(report)).toThrow(/HTTP health returned 502/u);
	});

	it('fails when a provider limitation prevents exact state', () => {
		const report = createTreeseedCanonicalReconcileReport({
			desiredGraph: [{ id: 'api:postgres-volume', provider: 'railway', type: 'volume' }],
			providerLimitations: [{
				id: 'api:postgres-volume:rename-limited',
				resourceId: 'api:postgres-volume',
				severity: 'blocking',
				reason: 'Railway does not allow renaming this managed PostgreSQL volume.',
			}],
			liveVerification: { ok: true, issues: [] },
		});
		expect(report.ok).toBe(false);
		expect(() => assertTreeseedCanonicalReconcileSuccess(report)).toThrow(/provider limitation/u);
	});

	it('fails when live verification reports unresolved issues', () => {
		const report = createTreeseedCanonicalReconcileReport({
			desiredGraph: [{ id: 'web:pages', provider: 'cloudflare', type: 'pages' }],
			liveVerification: {
				ok: false,
				source: 'cloudflare',
				issues: ['Cloudflare Pages deployment is still pending.'],
			},
		});
		expect(report.ok).toBe(false);
		expect(() => assertTreeseedCanonicalReconcileSuccess(report)).toThrow(/Cloudflare Pages deployment is still pending/u);
	});
});
