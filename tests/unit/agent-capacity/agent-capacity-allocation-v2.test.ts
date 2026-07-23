import { describe, expect, it } from 'vitest';
import {
	evaluateCapacityAdmission,
	validateCapacityAllocationSetV2,
	validateCapacityGrantV2,
	type CapacityAdmissionInput,
	type CapacityAllocationSetV2,
} from '../../../src/agent-capacity.ts';

function allocationSet(): CapacityAllocationSetV2 {
	return {
		schemaVersion: 2,
		id: 'allocation-1',
		teamId: 'team-1',
		version: 1,
		status: 'active',
		effectiveFrom: '2026-07-16T00:00:00.000Z',
		reservePolicy: { percent: 0, overflow: 'deny' },
		slices: [
			{ id: 'project-1', scope: 'project', targetId: 'project-1', policy: { minPercent: 40, targetPercent: 50, maxPercent: 60, hardCapPercent: 70 } },
			{ id: 'project-2', scope: 'project', targetId: 'project-2', policy: { minPercent: 30, targetPercent: 50, maxPercent: 60, hardCapPercent: 70 } },
			{ id: 'class-1', scope: 'agent-class', targetId: 'class-1', parentSliceId: 'project-1', policy: { minPercent: 50, targetPercent: 100, maxPercent: 100, hardCapPercent: 100 } },
			{ id: 'planning', scope: 'mode', targetId: 'planning', parentSliceId: 'class-1', policy: { minPercent: 10, targetPercent: 25, maxPercent: 40, hardCapPercent: 40 } },
			{ id: 'acting', scope: 'mode', targetId: 'acting', parentSliceId: 'class-1', policy: { minPercent: 60, targetPercent: 75, maxPercent: 90, hardCapPercent: 90 } },
		],
		borrowingRules: [],
	};
}

function admissionInput(): CapacityAdmissionInput {
	return {
		now: '2026-07-16T16:00:00.000Z',
		request: { teamId: 'team-1', providerId: 'provider-1', membershipId: 'membership-1', projectId: 'project-1', environment: 'local', agentClassId: 'class-1', mode: 'planning', executionProviderId: 'codex', laneId: 'standard', requiredCapabilities: ['engineering'], requestedCredits: 5 },
		membership: { id: 'membership-1', teamId: 'team-1', providerId: 'provider-1', status: 'approved' },
		availability: { status: 'open', availableFrom: '2026-07-16T15:00:00.000Z', availableUntil: '2026-07-16T18:00:00.000Z' },
		grant: { schemaVersion: 2, id: 'grant-1', membershipId: 'membership-1', teamId: 'team-1', providerId: 'provider-1', projectId: 'project-1', environment: 'local', status: 'active', executionProviderIds: ['codex'], laneIds: ['standard'], capabilities: ['engineering'], allowedModes: ['planning'], dailyCreditLimit: 50, monthlyCreditLimit: 200, maxConcurrentAssignments: 2 },
		workday: { id: 'workday-1', status: 'active', totalCredits: 100, committedCredits: 20 },
		allocationSet: allocationSet(),
		allocationSliceIds: ['project-1', 'class-1', 'planning'],
		committedCreditsBySlice: { 'project-1': 20, 'class-1': 20, planning: 15 },
		providerCapacity: { availableCredits: 30, availableConcurrentAssignments: 2 },
		providerLocalLimits: { availableCredits: 20, availableConcurrentAssignments: 1 },
		grantCommitted: { dailyCredits: 10, monthlyCredits: 40, activeAssignments: 0 },
	};
}

describe('capacity allocation v2', () => {
	it('requires explicit metering or unmetered policy on grants', () => {
		const base = { schemaVersion: 2 as const, id: 'grant-1', membershipId: 'membership-1', teamId: 'team-1', providerId: 'provider-1', projectId: 'project-1', environment: 'local', status: 'active' as const, executionProviderIds: ['codex'], laneIds: [], capabilities: ['engineering'], allowedModes: ['planning'] as const, maxConcurrentAssignments: 1, unmetered: false };
		expect(validateCapacityGrantV2({ ...base, allowedModes: [...base.allowedModes] }).ok).toBe(false);
		expect(validateCapacityGrantV2({ ...base, allowedModes: [...base.allowedModes], dailyCreditLimit: 10 }).ok).toBe(true);
		expect(validateCapacityGrantV2({ ...base, allowedModes: [...base.allowedModes], unmetered: true }).ok).toBe(true);
		expect(validateCapacityGrantV2({ ...base, allowedModes: [...base.allowedModes], dailyCreditLimit: 0 }).ok).toBe(true);
	});
	it('validates hierarchy totals and ordered bounds', () => {
		expect(validateCapacityAllocationSetV2(allocationSet())).toEqual({ ok: true, diagnostics: [] });
		const invalid = allocationSet();
		invalid.slices[0]!.policy.minPercent = 80;
		expect(validateCapacityAllocationSetV2(invalid).diagnostics.map((entry) => entry.code)).toContain('allocation_slice_bounds_invalid');
		const malformed = allocationSet();
		malformed.slices = [null as never];
		expect(() => validateCapacityAllocationSetV2(malformed)).not.toThrow();
		expect(validateCapacityAllocationSetV2(malformed).ok).toBe(false);
	});

	it('admits only through membership, grant, workday, allocation, and provider limits', () => {
		const decision = evaluateCapacityAdmission(admissionInput());
		expect(decision.allowed).toBe(true);
		expect(decision.maxReservableCredits).toBe(5);
		expect(decision).toMatchObject({ allocationPriorityBand: 'normal', allocationPriorityScore: 2 });
		expect(decision.policySnapshot).toMatchObject({ grantId: 'grant-1', allocationSetId: 'allocation-1', allocationVersion: 1 });
		expect(decision.counterClaims).toContainEqual(expect.objectContaining({
			id: 'allocation-slice:allocation-1:planning:workday-1',
			periodKey: 'workday-1',
		}));
	});

	it('assigns deterministic priority to below-minimum and below-target slices', () => {
		const belowMinimum = admissionInput();
		belowMinimum.committedCreditsBySlice.planning = 0;
		const belowTarget = admissionInput();
		belowTarget.committedCreditsBySlice.planning = 6;
		expect(evaluateCapacityAdmission(belowMinimum)).toMatchObject({ allocationPriorityBand: 'minimum', allocationPriorityScore: 4 });
		expect(evaluateCapacityAdmission(belowTarget)).toMatchObject({ allocationPriorityBand: 'target', allocationPriorityScore: 3 });
	});

	it('treats a zero grant limit as an explicit denial', () => {
		const input = admissionInput();
		input.grant!.dailyCreditLimit = 0;
		const decision = evaluateCapacityAdmission(input);
		expect(decision.allowed).toBe(false);
		expect(decision.reasonCodes).toContain('grant_credit_exhausted');
	});

	it('does not treat approved membership as capacity and accepts explicit unmetered grants', () => {
		const membershipOnly = admissionInput();
		membershipOnly.grant = null;
		expect(evaluateCapacityAdmission(membershipOnly).reasonCodes).toContain('missing_active_grant');
		const unmetered = admissionInput();
		unmetered.grant = { ...unmetered.grant!, dailyCreditLimit: null, monthlyCreditLimit: null, unmetered: true };
		expect(evaluateCapacityAdmission(unmetered).allowed).toBe(true);
	});

	it('rejects cross-team, cross-provider, and cross-membership identities', () => {
		const input = admissionInput();
		input.membership.id = 'membership-other';
		input.membership.teamId = 'team-other';
		input.grant!.providerId = 'provider-other';
		const decision = evaluateCapacityAdmission(input);
		expect(decision.reasonCodes).toEqual(expect.arrayContaining([
			'membership_id_mismatch',
			'membership_team_mismatch',
			'grant_provider_mismatch',
		]));
	});

	it('borrows only unused sibling capacity above the recipient maximum and below its hard cap', () => {
		const input = admissionInput();
		const allocation = input.allocationSet!;
		allocation.reservePolicy.overflow = 'borrow';
		const planning = allocation.slices.find((slice) => slice.id === 'planning')!;
		planning.policy.hardCapPercent = 60;
		allocation.borrowingRules = [{ id: 'acting-to-planning', fromSliceId: 'acting', toSliceId: 'planning', maxPercent: 20, requiresApproval: false }];
		input.committedCreditsBySlice.acting = 20;
		input.request.requestedCredits = 10;
		const decision = evaluateCapacityAdmission(input);
		expect(decision.allowed).toBe(true);
		expect(decision.maxReservableCredits).toBe(12.5);
		expect(decision.counterClaims).toEqual(expect.arrayContaining([
			expect.objectContaining({ scope: 'allocation-overflow', amount: 5 }),
			expect.objectContaining({ scope: 'allocation-borrow', amount: 5 }),
		]));
	});

	it('requires explicit approval when a borrowing rule says so', () => {
		const input = admissionInput();
		const allocation = input.allocationSet!;
		allocation.reservePolicy.overflow = 'borrow';
		allocation.slices.find((slice) => slice.id === 'planning')!.policy.hardCapPercent = 60;
		allocation.borrowingRules = [{ id: 'approval-rule', fromSliceId: 'acting', toSliceId: 'planning', maxPercent: 20, requiresApproval: true }];
		input.committedCreditsBySlice.acting = 20;
		input.request.requestedCredits = 10;
		const denied = evaluateCapacityAdmission(input);
		expect(denied.allowed).toBe(false);
		expect(denied.reasonCodes).toContain('allocation_borrowing_approval_required');
		input.approvedBorrowingRuleIds = ['approval-rule'];
		expect(evaluateCapacityAdmission(input).allowed).toBe(true);
	});

	it('protects a sibling minimum from borrowing', () => {
		const input = admissionInput();
		const allocation = input.allocationSet!;
		allocation.reservePolicy.overflow = 'borrow';
		allocation.slices.find((slice) => slice.id === 'planning')!.policy.hardCapPercent = 60;
		allocation.borrowingRules = [{ id: 'protected-donor', fromSliceId: 'acting', toSliceId: 'planning', maxPercent: 20, requiresApproval: false }];
		input.committedCreditsBySlice.acting = 37.5;
		input.request.requestedCredits = 10;
		const decision = evaluateCapacityAdmission(input);
		expect(decision.allowed).toBe(false);
		expect(decision.reasonCodes).toContain('allocation_hard_cap_exhausted');
	});

	it('uses the explicit root reserve without charging a sibling', () => {
		const input = admissionInput();
		input.allocationSet = {
			...allocationSet(),
			reservePolicy: { percent: 10, overflow: 'borrow' },
			slices: [{ id: 'project-1', scope: 'project', targetId: 'project-1', policy: { minPercent: 50, targetPercent: 90, maxPercent: 90, hardCapPercent: 100 } }],
			borrowingRules: [],
		};
		input.allocationSliceIds = ['project-1'];
		input.committedCreditsBySlice = { 'project-1': 90 };
		input.request.requestedCredits = 5;
		const decision = evaluateCapacityAdmission(input);
		expect(decision.allowed).toBe(true);
		expect(decision.counterClaims).toContainEqual(expect.objectContaining({ scope: 'allocation-reserve', amount: 5, hardLimit: 10 }));
	});

	it('blocks an exhausted mode hard cap', () => {
		const input = admissionInput();
		input.committedCreditsBySlice.planning = 40;
		const decision = evaluateCapacityAdmission(input);
		expect(decision.allowed).toBe(false);
		expect(decision.reasonCodes).toContain('allocation_borrowing_denied');
	});

	it('denies a lane outside the active grant', () => {
		const input = admissionInput();
		input.request.laneId = 'restricted';
		const decision = evaluateCapacityAdmission(input);
		expect(decision.allowed).toBe(false);
		expect(decision.reasonCodes).toContain('grant_lane_denied');
	});

	it('enforces all acting provenance gates', () => {
		const input = admissionInput();
		input.request.mode = 'acting';
		input.request.requestedCredits = 1;
		input.request.requiredCapabilities = [];
		input.grant!.allowedModes = ['acting'];
		input.allocationSliceIds = ['project-1', 'class-1', 'acting'];
		input.acting = { decisionApproved: false, readinessReady: false, capacityPlanAccepted: false };
		const decision = evaluateCapacityAdmission(input);
		expect(decision.allowed).toBe(false);
		expect(decision.reasonCodes).toEqual(expect.arrayContaining(['acting_decision_not_approved', 'acting_readiness_not_ready', 'acting_capacity_plan_not_accepted']));
	});
});
