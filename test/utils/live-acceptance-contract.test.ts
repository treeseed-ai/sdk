import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	compileTreeseedLiveAcceptanceScenarios,
	treeseedLiveReconcileProviderCapabilities,
	type TreeseedLiveReconcileProvider,
} from '../../src/reconcile/index.ts';
import { createdEngineeringProposalId } from '../../src/reconcile/live-acceptance-starter-engineering.ts';
import { finalizeLocalStarterAcceptance, localStarterDurationSeconds, localStarterProjectSlug, terminalizeStarterWorkdayRun } from '../../src/reconcile/live-acceptance-starter-runtime.ts';
import type { MarketClient } from '../../src/market-client.ts';
import { describeCapacityAcceptanceError } from '../../src/reconcile/live-acceptance-capacity-cleanup.ts';
import { concurrentProjectClassTransitionKey, hasConcurrentUsageAndExactlyOnceSettlement } from '../../src/reconcile/live-acceptance-starter-concurrency.ts';
import { hasAuthenticatedCommittedContentReferences } from '../../src/reconcile/live-acceptance-capacity-terminal.ts';

const providers: TreeseedLiveReconcileProvider[] = ['railway', 'cloudflare', 'github', 'local'];
const reconcileRoot = fileURLToPath(new URL('../../src/reconcile/', import.meta.url));

describe('live acceptance scenario contract', () => {
	it('bounds real-provider starter duration by the same hard assignment-credit budget', () => {
		expect(localStarterDurationSeconds({ credits: 64 })).toBe(38_400);
		expect(localStarterDurationSeconds({ credits: 64, durationSeconds: 7_200 })).toBe(7_200);
		expect(() => localStarterDurationSeconds({ credits: 0 })).toThrow('positive whole number');
	});

	it('gives sequential and concurrent portfolio projects distinct run-scoped slugs', () => {
		expect(localStarterProjectSlug('engineering', '20260722035529')).toBe('engineering-20260722035529');
		expect(localStarterProjectSlug('engineering', '20260722035529-portfolio')).toBe('engineering-60722035529portfolio');
		expect(localStarterProjectSlug('research', '20260722035529-portfolio')).toBe('research-60722035529portfolio');
	});

	it('cancels failed starter runs and preserves both execution and cleanup failures', async () => {
		const statuses: string[] = [];
		await expect(finalizeLocalStarterAcceptance(async (status) => {
			statuses.push(status);
			throw new Error('cleanup failed');
		}, new Error('execution failed'), 'Engineering starter')).rejects.toMatchObject({
			name: 'AggregateError',
			message: 'Engineering starter execution and cleanup both failed.',
			errors: [expect.objectContaining({ message: 'execution failed' }), expect.objectContaining({ message: 'cleanup failed' })],
		});
		expect(statuses).toEqual(['cancelled']);
	});

	it('completes successful starter runs', async () => {
		const statuses: string[] = [];
		await finalizeLocalStarterAcceptance(async (status) => { statuses.push(status); }, null, 'Research starter');
		expect(statuses).toEqual(['completed']);
	});

	it('preserves nested acceptance errors in the operator-facing diagnostic', () => {
		const error = new AggregateError([
			new Error('engineering project provisioning failed'),
			new AggregateError([new Error('research cleanup remained blocked')], 'research cleanup failed'),
		], 'concurrent portfolio failed');
		expect(describeCapacityAcceptanceError(error)).toBe(
			'concurrent portfolio failed [engineering project provisioning failed; research cleanup failed [research cleanup remained blocked]]',
		);
	});

	it('does not rewrite an already terminal starter workday during cleanup', async () => {
		let updates = 0;
		const client = {
			async workdayRun() { return { payload: { run: { id: 'run-a', status: 'failed' } } }; },
			async updateWorkdayRun() { updates += 1; return { payload: {} }; },
		} as unknown as MarketClient;
		await expect(terminalizeStarterWorkdayRun({
			adminClient: client, teamId: 'team-a', workdayRunId: 'run-a', status: 'cancelled', summary: {},
		})).resolves.toMatchObject({ id: 'run-a', status: 'failed' });
		expect(updates).toBe(0);
	});

	it('scopes concurrent class-transition idempotency to the project', () => {
		const engineering = concurrentProjectClassTransitionKey('run-a', 'engineering-project', 'pause', 'review');
		const research = concurrentProjectClassTransitionKey('run-a', 'research-project', 'pause', 'review');
		expect(engineering).not.toBe(research);
		expect(new Set([engineering, research]).size).toBe(2);
	});

	it('allows dimensional usage evidence while requiring one financial settlement per assignment', () => {
		expect(hasConcurrentUsageAndExactlyOnceSettlement([
			{ usageActualCount: 2, ledgerEntryCount: 1 },
			{ usageActualCount: 3, ledgerEntryCount: 1 },
		])).toBe(true);
		expect(hasConcurrentUsageAndExactlyOnceSettlement([
			{ usageActualCount: 2, ledgerEntryCount: 2 },
		])).toBe(false);
	});

	it('authenticates content provenance by manifest event identity rather than one tool implementation', () => {
		const events = [
			{ id: 'tool:create-question', toolId: 'treeseed.content.create', status: 'completed', derivedEventTypes: ['question_created', 'content_created'] },
			{ id: 'tool:write-note', toolId: 'treedx.write_workspace_file', status: 'completed', derivedEventTypes: ['content_created'] },
			{ id: 'tool:commit', toolId: 'treeseed.content.commit', status: 'completed', derivedEventTypes: ['content_committed'] },
		];
		expect(hasAuthenticatedCommittedContentReferences([
			{ model: 'question', contentPath: 'questions/decomposition.mdx', receiptId: 'receipt:question', toolEventId: 'tool:create-question' },
			{ model: 'note', contentPath: 'notes/research/context.mdx', receiptId: 'receipt:note', toolEventId: 'tool:write-note' },
		], events, 1)).toBe(true);
		expect(hasAuthenticatedCommittedContentReferences([
			{ model: 'question', contentPath: 'questions/decomposition.mdx', receiptId: 'receipt:question', toolEventId: 'tool:missing' },
		], events, 1)).toBe(false);
		expect(hasAuthenticatedCommittedContentReferences([
			{ model: 'question', contentPath: 'questions/decomposition.mdx', receiptId: 'receipt:question', toolEventId: 'tool:create-question' },
		], events.filter((event) => event.id !== 'tool:commit'), 1)).toBe(false);
	});

	it('links engineering estimates to the proposal actually created by the real provider', () => {
		expect(createdEngineeringProposalId({
			lifecycleOutput: { artifactManifest: { contentReferences: [
				{ model: 'note', contentPath: 'template/src/content/notes/proposal-feedback.mdx' },
				{ model: 'proposal', contentPath: 'template/src/content/proposals/provider-created-proposal.mdx' },
			] } },
		})).toBe('provider-created-proposal');
		expect(createdEngineeringProposalId({ lifecycleOutput: { artifactManifest: { contentReferences: [] } } })).toBeNull();
	});

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
