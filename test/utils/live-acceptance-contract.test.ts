import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	compileTreeseedLiveAcceptanceScenarios,
	treeseedLiveReconcileProviderCapabilities,
	type TreeseedLiveReconcileProvider,
} from '../../src/reconcile/index.ts';

const providers: TreeseedLiveReconcileProvider[] = ['railway', 'cloudflare', 'github', 'local'];
const reconcileRoot = fileURLToPath(new URL('../../src/reconcile/', import.meta.url));

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

	it('keeps every live-acceptance production module focused and provider lifecycles out of the coordinator', () => {
		const modules = readdirSync(reconcileRoot)
			.filter((name) => /^live-acceptance(?:-[a-z-]+)?\.ts$/u.test(name))
			.sort();
		expect(modules).toEqual(expect.arrayContaining([
			'live-acceptance-cloudflare.ts',
			'live-acceptance-github.ts',
			'live-acceptance-local.ts',
			'live-acceptance-railway.ts',
			'live-acceptance.ts',
		]));
		for (const module of modules) {
			const source = readFileSync(`${reconcileRoot}/${module}`, 'utf8');
			expect(source.split(/\r?\n/u).length, `${module} line count`).toBeLessThanOrEqual(500);
			expect(source, `${module} compiler suppression`).not.toMatch(/@ts-(?:check|ignore|nocheck)|eslint-disable/iu);
		}

		const coordinator = readFileSync(`${reconcileRoot}/live-acceptance.ts`, 'utf8');
		expect(coordinator).not.toMatch(/function run(?:Railway|Cloudflare|GitHub|Local)(?:Acceptance|Cleanup)/u);
	});
});
