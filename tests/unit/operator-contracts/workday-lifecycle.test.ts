import { describe, expect, it } from 'vitest';
import { validateSelectedDemand, validateWorkdayIntent, validateWorkdayPreflight, validateWorkdayPreflightFreshness, validateWorkdaySettlement, validateWorkdayIntentSelection, normalizeWorkdayAgentSelection, type WorkdayPreflightReceipt, type WorkdayIntent } from '../../../src/operator-contracts/index.ts';

describe('time-based workday lifecycle contracts', () => {
	it('retains bounded provider constraints and rejects malformed unknown or duplicate supply selectors without changing workday authority', () => {
		const base: WorkdayIntent = { schemaVersion: 'treeseed.workday-intent/v1', teamId: 'team', profileId: 'default',
			projects: 'all', startsAt: '2026-09-16T12:00:00Z' };
		for (const operatorConstraints of [{}, { providerIds: [] }, { providerIds: ['provider', 'second'], maxConcurrency: 1 },
			{ providerIds: ['x'.repeat(200)] }, { maxConcurrency: 2 }]) {
			const intent = { ...base, operatorConstraints }, before = structuredClone(intent);
			expect(validateWorkdayIntent(intent)).toEqual([]); expect(intent).toEqual(before);
		}
		for (const operatorConstraints of [null, [], '', true, { unknown: 1 }, ...[null, '', [''], [' '], ['same', 'same'],
			[null], [1], ['x'.repeat(201)], ['provider?']].map(providerIds => ({ providerIds })),
			...[null, '', '1', 0, -1, 0.5, true, Number.NaN, Number.POSITIVE_INFINITY].map(maxConcurrency => ({ maxConcurrency }))]) {
			const intent = Object.assign({}, base, { operatorConstraints }), before = structuredClone(intent);
			expect(validateWorkdayIntent(intent)).toContainEqual(expect.objectContaining({ code: 'operator_constraints_invalid', path: 'operatorConstraints' }));
			expect(intent).toEqual(before);
		}
	});
	it('requires explicit all or unique canonical project identities without broadening missing malformed or repeated project scope', () => {
		const base: WorkdayIntent = { schemaVersion: 'treeseed.workday-intent/v1', teamId: 'team', profileId: 'default',
			projects: 'all', startsAt: '2026-09-16T12:00:00Z' };
		for (const projects of ['all', ['sdk', 'api'], ['A', 'a'], ['x'.repeat(200)]]) {
			const intent = Object.assign({}, base, { projects }), before = structuredClone(intent);
			expect(validateWorkdayIntent(intent)).toEqual([]); expect(intent).toEqual(before);
		}
		const missing = { ...base }; Reflect.deleteProperty(missing, 'projects');
		for (const intent of [missing, ...[undefined, null, [], '', 'sdk', 1, true, [null], [[]], [{}], [''], [' '],
			['sdk', 'sdk'], ['sdk', ' sdk '], ['sdk', null], ['x'.repeat(201)], ['sdk?']]
			.map(projects => Object.assign({}, base, { projects }))]) {
			const before = structuredClone(intent);
			expect(validateWorkdayIntent(intent)).toContainEqual(expect.objectContaining({ code: 'project_selection_invalid', path: 'projects' }));
			expect(intent).toEqual(before);
		}
	});
	it('rejects duplicate trimmed decision identities and every malformed explicit selection without changing intent', () => {
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default', projects: 'all' as const, startsAt: '2026-09-16T12:00:00Z', durationSeconds: 3600 };
		for (const decisionIds of [[], [''], [' \t\n '], ['one', ' one '], ['same', 'same'], [null], [1], 'one', null, Array.from({ length: 65 }, (_, i) => `decision-${i}`), ['x'.repeat(129)]]) {
			const intent: WorkdayIntent = { ...base };
			Object.assign(intent, { decisionIds });
			const before = structuredClone(intent);
			expect(validateWorkdayIntent(intent)).toContainEqual(expect.objectContaining({ code: 'decision_selection_invalid', path: 'decisionIds' }));
			expect(intent).toEqual(before);
		}
		for (const decisionIds of [['A', 'a'], ['é', 'e\u0301'], Array.from({ length: 64 }, (_, i) => `decision-${i}`), ['x'.repeat(128)]]) {
			const intent = { ...base, decisionIds };
			const before = structuredClone(intent);
			expect(validateWorkdayIntent(intent)).toEqual([]);
			expect(intent).toEqual(before);
		}
	});

	it('rejects each named derived identity even when its supplied value would disappear during JSON serialization', () => {
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default', projects: 'all' as const, startsAt: '2026-09-16T12:00:00Z', durationSeconds: 3600 };
		for (const field of ['executionPlanId', 'capacityPlanId', 'executionInputId', 'demandSetId']) {
			for (const value of [undefined, null, '', 'derived-identity']) {
				const intent = Object.assign({}, base, { [field]: value });
				const before = structuredClone(intent);
				expect(validateWorkdayIntent(intent)).toContainEqual({ code: 'field_forbidden', path: field, message: 'Derived execution state is not portable workday intent.' });
				expect(intent).toEqual(before);
				expect(Object.hasOwn(intent, field)).toBe(true);
			}
		}
	});

	it('preserves omitted decisions and independent planning proposal agent and allocation controls', () => {
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default', projects: ['sdk'], startsAt: '2026-09-16T12:00:00Z', durationSeconds: 3600,
			proposalIds: ['proposal-original'], agentSelection: { agentSlugs: ['configured-arbitrary-agent'], activityTypes: ['planning'] }, allocation: { planningPercent: 20, allocationWeight: 2 } };
		for (const planningOnly of [false, true]) {
			const intent = { ...base, planningOnly };
			const before = structuredClone(intent);
			expect(validateWorkdayIntent(intent)).toEqual([]);
			expect(intent).toEqual(before);
			expect(Object.hasOwn(intent, 'decisionIds')).toBe(false);
		}
	});
	it('validates explicit custody mode without granting free simulation capacity', () => {
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default',
			projects: 'all' as const, startsAt: '2026-09-16T12:00:00Z' };
		for (const executionMode of ['simulation', 'production'] as const) expect(validateWorkdayIntent({ ...base, executionMode })).toEqual([]);
		expect(validateWorkdayIntent({ ...base, executionMode: 'other' } as never)).toContainEqual(expect.objectContaining({ code: 'execution_mode_invalid' }));
	});
	it('rejects derived execution state in operator workday intent', () => {
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default',
			projects: 'all' as const, startsAt: '2026-09-16T12:00:00Z' };
		for (const field of ['graph', 'executionPlan', 'capacityPlan']) {
			expect(validateWorkdayIntent({ ...base, [field]: {} } as never)).toContainEqual(expect.objectContaining({ code: 'field_forbidden', path: field }));
		}
	});
	it('validates high-level allocation through the canonical policy contract', () => {
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default',
			projects: 'all' as const, startsAt: '2026-09-16T12:00:00Z', durationSeconds: 3600 };
		expect(validateWorkdayIntent({ ...base, allocation: { planningPercent: 20, allocationWeight: 2,
			projectPercentages: { sdk: 60, api: 40 }, agentClassPercentages: { sdk: { engineer: 100 } } } })).toEqual([]);
		for (const allocation of [{ planningPercent: 101 }, { allocationWeight: 0 }, { planningTurnMaximumSeconds: 0 },
			{ projectPercentages: { sdk: -1 } }, { agentClassPercentages: { sdk: { engineer: 0 } } }, { planningSecondsPerAgent: 30 }]) {
			expect(validateWorkdayIntent({ ...base, allocation } as never).map((issue) => issue.code)).toContain('allocation_invalid');
		}
	});
	it('supports normalized explicit planning agent/activity selection', () => {
		const selection = { agentSlugs: ['reviewer', ' architect ', 'reviewer'], activityTypes: ['reviewing'] };
		expect(validateWorkdayIntentSelection(selection)).toEqual([]);
		expect(normalizeWorkdayAgentSelection(selection)).toEqual({ agentSlugs: ['architect','reviewer'], activityTypes: ['reviewing'], classIds: [], classSlugs: [], mode: 'intersection' });
	});
	it.each([null, [], {}, { mode: 'union' }, { agentSlugs: [] }, { agentSlugs: [''] }, { agentSlugs: [1] }, { agentSlugs: 'reviewer' }, { agentSlugs: ['reviewer'], mode: 'all' }, { agentSlugs: ['reviewer'], unknown: true }, { activityTypes: ['acting'] }, { activityTypes: ['typo'] }])('rejects malformed or silently broadening selection %j', value => {
		expect(validateWorkdayIntentSelection(value).length).toBeGreaterThan(0);
	});
	it('accepts a duration or explicit range, never both', () => {
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'feature-heavy', projects: 'all' as const, startsAt: '2026-08-21T12:00:00.000Z' };
		expect(validateWorkdayIntent({ ...base, durationSeconds: 3600 })).toEqual([]);
		expect(validateWorkdayIntent({ ...base, durationSeconds: 3600, decisionIds: ['decision-1'] })).toEqual([]);
		expect(validateWorkdayIntent({ ...base, durationSeconds: 3600, planningOnly: true, proposalIds: ['proposal-1'] })).toEqual([]);
		expect(validateWorkdayIntent({ ...base, endsAt: '2026-08-21T13:00:00.000Z' })).toEqual([]);
		expect(validateWorkdayIntent({ ...base, endsAt: '2026-08-21T13:00:00.000Z', durationSeconds: 3600 }).map((item) => item.code)).toContain('time_range_ambiguous');
	});

	it('requires explicit accepted decisions for continuation, without changing fresh intent', () => {
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default', projects: ['sdk'], startsAt: '2026-08-21T12:00:00Z' };
		expect(validateWorkdayIntent({ ...base, continueFromWorkdayId: 'previous', decisionIds: ['decision'] })).toEqual([]);
		for (const value of [{ continueFromWorkdayId: '' }, { continueFromWorkdayId: 'previous' },
			{ continueFromWorkdayId: 'previous', decisionIds: ['decision'], proposalIds: ['new'] },
			{ continueFromWorkdayId: 'previous', decisionIds: ['decision'], planningOnly: true }])
			expect(validateWorkdayIntent({ ...base, ...value }).map(item => item.code)).toContain('continuation_invalid');
		expect(validateWorkdayIntent(base)).toEqual([]);
	});

	it('rejects malformed decision selection without broadening to all decisions', () => {
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'feature-heavy', projects: 'all' as const, startsAt: '2026-08-21T12:00:00.000Z', durationSeconds: 3600 };
		expect(validateWorkdayIntent({ ...base, decisionIds: [] }).map((item) => item.code)).toContain('decision_selection_invalid');
		expect(validateWorkdayIntent({ ...base, decisionIds: [''] }).map((item) => item.code)).toContain('decision_selection_invalid');
		expect(validateWorkdayIntent({ ...base, proposalIds: [] }).map((item) => item.code)).toContain('proposal_selection_invalid');
	});

	it('allows planning without a decision and rejects acting without full authority', () => {
		const base = { id: 'demand', projectId: 'sdk', sourceType: 'planning-input', sourceId: 'input', classSlug: 'features', requestedSeconds: 600, priority: 10 };
		expect(validateSelectedDemand({ ...base, mode: 'planning' })).toEqual([]);
		expect(validateSelectedDemand({ ...base, mode: 'acting' }).map((item) => item.code)).toContain('acting_authority_required');
		expect(validateSelectedDemand({ ...base, mode: 'acting', actingAuthority: { decisionId: 'decision', decisionRevision: 1, executionNodeId: 'node', executionNodeRevision: 2, graphRevision: 3, sourceDigest: 'sha256:source' } })).toEqual([]);
		expect(validateSelectedDemand({ ...base, mode: 'acting', actingAuthority: { decisionId: '', decisionRevision: 1, executionNodeId: 'node', executionNodeRevision: 2, graphRevision: 3, sourceDigest: 'sha256:source' } }).map((item) => item.code)).toContain('acting_authority_identity_missing');
	});

	it('rejects expired preflight and missing identity digests', () => {
		const receipt: WorkdayPreflightReceipt = {
			schemaVersion: 'treeseed.workday-preflight/v1', id: 'preflight', teamId: 'team', intentDigest: '', profileId: 'profile', profileVersion: '1', profileGeneration: 1, profileDigest: 'sha256:profile', demandSetDigest: 'sha256:demand', providerCapacityDigest: 'sha256:provider', authorizationDigest: 'sha256:auth', reservationDigest: 'sha256:reservation', selectedDemands: [], classAccounting: [], startsAt: '2026-08-21T12:00:00.000Z', endsAt: '2026-08-21T13:00:00.000Z', maxConcurrency: 2, preflightDigest: 'sha256:preflight', expiresAt: '2026-08-21T11:00:00.000Z',
		};
		expect(validateWorkdayPreflight(receipt, new Date('2026-08-21T12:00:00.000Z')).map((item) => item.code)).toEqual(expect.arrayContaining(['digest_required', 'preflight_expired']));
		expect(validateWorkdayPreflight({ ...receipt, expiresAt: 'invalid' }, new Date('2026-08-21T12:00:00.000Z')).map((item) => item.code)).toContain('preflight_expiry_invalid');
		expect(validateWorkdayPreflightFreshness(receipt, { profileGeneration: 2, profileDigest: receipt.profileDigest, demandSetDigest: receipt.demandSetDigest, providerCapacityDigest: receipt.providerCapacityDigest, authorizationDigest: receipt.authorizationDigest, reservationDigest: receipt.reservationDigest })).toEqual([expect.objectContaining({ code: 'preflight_state_changed', path: 'profileGeneration' })]);
	});

	it('validates audited settlement accounting', () => {
		const settlement = { schemaVersion: 'treeseed.workday-settlement/v1' as const, workdayId: 'day', status: 'completed' as const, preflightDigest: 'sha256:preflight', classAccounting: [{ classSlug: 'features', allocatedSeconds: 100, idleSeconds: 10, reservedSeconds: 100, activeSeconds: 90, releasedSeconds: 10, overrunSeconds: 0 }], assignmentIds: [], releasedReservationIds: [], artifactRefs: [], startedAt: '2026-08-21T12:00:00.000Z', completedAt: '2026-08-21T13:00:00.000Z', settlementDigest: 'sha256:settlement' };
		expect(validateWorkdaySettlement(settlement)).toEqual([]);
		expect(validateWorkdaySettlement({ ...settlement, classAccounting: [{ ...settlement.classAccounting[0]!, overrunSeconds: -1 }] }).map((item) => item.code)).toEqual(expect.arrayContaining(['settlement_accounting_invalid']));
	});
});
