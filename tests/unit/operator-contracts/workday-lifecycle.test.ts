import { describe, expect, it } from 'vitest';
import { validateSelectedDemand, validateWorkdayIntent, validateWorkdayPreflight, validateWorkdayPreflightFreshness, validateWorkdaySettlement, type WorkdayPreflightReceipt } from '../../../src/operator-contracts/index.ts';

describe('time-based workday lifecycle contracts', () => {
	it('accepts a duration or explicit range, never both', () => {
		const base = { schemaVersion: 'treeseed.workday-intent/v1' as const, teamId: 'team', profileId: 'feature-heavy', projects: 'all' as const, startsAt: '2026-08-21T12:00:00.000Z' };
		expect(validateWorkdayIntent({ ...base, durationSeconds: 3600 })).toEqual([]);
		expect(validateWorkdayIntent({ ...base, endsAt: '2026-08-21T13:00:00.000Z' })).toEqual([]);
		expect(validateWorkdayIntent({ ...base, endsAt: '2026-08-21T13:00:00.000Z', durationSeconds: 3600 }).map((item) => item.code)).toContain('time_range_ambiguous');
	});

	it('allows planning without a decision and rejects acting without full authority', () => {
		const base = { id: 'demand', projectId: 'sdk', sourceType: 'planning-input', sourceId: 'input', classSlug: 'features', requestedSeconds: 600, priority: 10 };
		expect(validateSelectedDemand({ ...base, mode: 'planning' })).toEqual([]);
		expect(validateSelectedDemand({ ...base, mode: 'acting' }).map((item) => item.code)).toContain('acting_authority_required');
		expect(validateSelectedDemand({ ...base, mode: 'acting', actingAuthority: { decisionId: 'decision', decisionStatus: 'approved', executionInputId: 'execution', executionInputStatus: 'accepted', estimateId: 'estimate', capacityPlanId: 'plan', capacityPlanDigest: 'sha256:plan' } })).toEqual([]);
		expect(validateSelectedDemand({ ...base, mode: 'acting', actingAuthority: { decisionId: '', decisionStatus: 'approved', executionInputId: 'execution', executionInputStatus: 'accepted', estimateId: 'estimate', capacityPlanId: 'plan', capacityPlanDigest: 'sha256:plan' } }).map((item) => item.code)).toContain('acting_authority_identity_missing');
	});

	it('rejects expired preflight and missing identity digests', () => {
		const receipt: WorkdayPreflightReceipt = {
			schemaVersion: 'treeseed.workday-preflight/v1', id: 'preflight', teamId: 'team', intentDigest: '', profileId: 'profile', profileVersion: '1', profileGeneration: 1, profileDigest: 'sha256:profile', demandSetDigest: 'sha256:demand', providerCapacityDigest: 'sha256:provider', authorizationDigest: 'sha256:auth', reservationDigest: 'sha256:reservation', selectedDemands: [], classAccounting: [], borrowing: [], startsAt: '2026-08-21T12:00:00.000Z', endsAt: '2026-08-21T13:00:00.000Z', maxConcurrency: 2, reserveSeconds: 10, preflightDigest: 'sha256:preflight', expiresAt: '2026-08-21T11:00:00.000Z',
		};
		expect(validateWorkdayPreflight(receipt, new Date('2026-08-21T12:00:00.000Z')).map((item) => item.code)).toEqual(expect.arrayContaining(['digest_required', 'preflight_expired']));
		expect(validateWorkdayPreflight({ ...receipt, expiresAt: 'invalid' }, new Date('2026-08-21T12:00:00.000Z')).map((item) => item.code)).toContain('preflight_expiry_invalid');
		expect(validateWorkdayPreflightFreshness(receipt, { profileGeneration: 2, profileDigest: receipt.profileDigest, demandSetDigest: receipt.demandSetDigest, providerCapacityDigest: receipt.providerCapacityDigest, authorizationDigest: receipt.authorizationDigest, reservationDigest: receipt.reservationDigest })).toEqual([expect.objectContaining({ code: 'preflight_state_changed', path: 'profileGeneration' })]);
	});

	it('validates audited settlement accounting', () => {
		const settlement = { schemaVersion: 'treeseed.workday-settlement/v1' as const, workdayId: 'day', status: 'completed' as const, preflightDigest: 'sha256:preflight', classAccounting: [{ classSlug: 'features', allocatedSeconds: 100, borrowedSeconds: 20, lentSeconds: 0, idleSeconds: 10, reservedSeconds: 100, activeSeconds: 90, releasedSeconds: 10, overrunSeconds: 0 }], assignmentIds: [], releasedReservationIds: [], artifactRefs: [], startedAt: '2026-08-21T12:00:00.000Z', completedAt: '2026-08-21T13:00:00.000Z', settlementDigest: 'sha256:settlement' };
		expect(validateWorkdaySettlement(settlement)).toEqual([]);
		expect(validateWorkdaySettlement({ ...settlement, classAccounting: [{ ...settlement.classAccounting[0]!, lentSeconds: 200, overrunSeconds: -1 }] }).map((item) => item.code)).toEqual(expect.arrayContaining(['settlement_accounting_invalid', 'settlement_lending_invalid']));
	});
});
