import { describe, expect, it } from 'vitest';
import {
	compileTreeseedLiveAcceptanceScenarios,
	treeseedLiveReconcileProviderCapabilities,
	type TreeseedLiveReconcileProvider,
} from '../../src/reconcile/index.ts';

const providers: TreeseedLiveReconcileProvider[] = ['railway', 'cloudflare', 'github', 'local'];

describe('live acceptance scenario contract', () => {
	it('declares one scenario for every provider capability', () => {
		for (const provider of providers) {
			const expected = treeseedLiveReconcileProviderCapabilities(provider).sort();
			const scenarios = compileTreeseedLiveAcceptanceScenarios({
				tenantRoot: process.cwd(),
				environment: provider === 'local' ? 'local' : 'staging',
				provider,
				mode: 'acceptance',
				runId: '20260613120000',
			});
			expect(scenarios.map((scenario) => scenario.capability).sort()).toEqual(expected);
		}
	});

	it('requires desired resources or explicit probes and cleanup for mutation scenarios', () => {
		const scenarios = compileTreeseedLiveAcceptanceScenarios({
			tenantRoot: process.cwd(),
			environment: 'staging',
			provider: 'all',
			mode: 'acceptance',
			runId: '20260613120000',
		});
		expect(scenarios.length).toBeGreaterThan(0);
		for (const scenario of scenarios) {
			expect(scenario.required, scenario.id).toBe(true);
			if (scenario.probeOnly) {
				expect(scenario.desiredResources, scenario.id).toEqual([]);
				expect(scenario.expectedActions, scenario.id).toContain('noop');
			} else {
				expect(scenario.desiredResources.length, scenario.id).toBeGreaterThan(0);
				expect(scenario.cleanupRequired, scenario.id).toBe(true);
				expect(scenario.cleanupSelector.host, scenario.id).toEqual([scenario.provider]);
			}
		}
	});

	it('treats capacity runtime proof records as control-plane probes instead of reconciled resources', () => {
		const scenarios = compileTreeseedLiveAcceptanceScenarios({
			tenantRoot: process.cwd(),
			environment: 'staging',
			provider: 'all',
			mode: 'acceptance',
			runId: '20260613120000',
		});
		const proofScenarios = scenarios.filter((scenario) => scenario.capability.includes('assignment-proof'));
		expect(proofScenarios.map((scenario) => scenario.capability).sort()).toEqual([
			'capacity-provider-assignment-proof',
			'capacity-provider-runtime-assignment-proof',
		]);
		for (const scenario of proofScenarios) {
			expect(scenario.probeOnly, scenario.id).toBe(true);
			expect(scenario.desiredResources, scenario.id).toEqual([]);
			expect(scenario.expectedActions, scenario.id).toEqual(['noop']);
			expect(scenario.cleanupRequired, scenario.id).toBe(false);
		}
	});
});
