import { describe, expect, it } from 'vitest';
import { validateSelectedDemand, validateWorkdayIntent, validateWorkdayPreflight, validateWorkdayPreflightFreshness, validateWorkdaySettlement, validateWorkdayIntentSelection, normalizeWorkdayAgentSelection, type WorkdayPreflightReceipt } from '../../../src/operator-contracts/index.ts';

describe('time-based workday lifecycle contracts', () => {
	it('validates explicit custody mode without granting free simulation capacity', () => {
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'default',
			projects: 'all' as const, startsAt: '2026-09-16T12:00:00Z' };
		for (const executionMode of ['simulation', 'production'] as const) expect(validateWorkdayIntent({ ...base, executionMode })).toEqual([]);
		expect(validateWorkdayIntent({ ...base, executionMode: 'other' } as never)).toContainEqual(expect.objectContaining({ code: 'execution_mode_invalid' }));
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
