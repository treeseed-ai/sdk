import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKDAY_POLICY, allocateWorkdayCapacity, calculateAssignmentAllocation, compilePlanningRounds, compileWorkday,
	selectFairReadyNode, workdayPolicySchema } from '../../../../src/capacity/agents/agent-capacity.ts';

const policy = workdayPolicySchema.parse({ ...DEFAULT_WORKDAY_POLICY, durationSeconds: 60, planningPercent: 20, maximumConcurrency: 2,
	communicationConcurrency: 1, projectPercentages: { first: 1, second: 1 }, agentClassPercentages: { first: { author: 1, verifier: 1 } } });
function plan(id: string, weight = 1) { return { ...compileWorkday({ id, teamId: 'team', policyId: 'default', policyRevision: 1,
	executionMode: 'simulation', policy: { ...policy, allocationWeight: weight }, agentIds: ['configured/a', 'configured/b'],
	startsAt: '2026-10-03T00:00:00.000Z' }), state: 'active' as const }; }
describe('workday allocation exact shared supply', () => {
	it('normalizes active weights with exact integer residual ties while preserving commitments and redistributing only graph-ready demand', () => {
		const now = '2026-10-03T00:00:20.000Z';
		const workdays = [{ plan: plan('a', 2), committedSeconds: 4, planningCommittedSeconds: 4, maximumAdditionalSeconds: 40, actingReady: true },
			{ plan: plan('b', 1), committedSeconds: 0, planningCommittedSeconds: 0, maximumAdditionalSeconds: 40, actingReady: true },
			{ plan: plan('idle', 10), committedSeconds: 0, planningCommittedSeconds: 0, maximumAdditionalSeconds: 0, actingReady: false }];
		const before = structuredClone(workdays);
		for (const ordered of [workdays, [...workdays].reverse(), [workdays[1]!, workdays[2]!, workdays[0]!]]) {
			const result = allocateWorkdayCapacity({ now, remainingSeconds: 8, workdays: ordered });
			expect(Object.fromEntries(Object.entries(result).map(([id, value]) => [id, value.availableSeconds]))).toEqual({ a: 4, b: 4, idle: 0 });
			expect(result.a).toMatchObject({ weight: 2, totalEligibleWeight: 3, committedSeconds: 4, planningCommittedSeconds: 4, remainingSupplySeconds: 8 });
		}
		const tied = ['c', 'a', 'b'].map(id => ({ ...workdays[1]!, plan: plan(id) }));
		for (const ordered of [tied, [...tied].reverse()]) {
			const result = allocateWorkdayCapacity({ now, remainingSeconds: 2, workdays: ordered });
			expect(Object.fromEntries(Object.entries(result).map(([id, value]) => [id, value.availableSeconds]))).toEqual({ a: 1, b: 1, c: 0 });
		}
		const ready = structuredClone(workdays); ready[2]!.maximumAdditionalSeconds = 40; ready[2]!.actingReady = true;
		const result = allocateWorkdayCapacity({ now, remainingSeconds: 8, workdays: ready });
		expect(Object.fromEntries(Object.entries(result).map(([id, value]) => [id, value.availableSeconds]))).toEqual({ a: 0, b: 1, idle: 7 });
		expect(result.a!.committedSeconds).toBe(4); expect(result.idle!.totalEligibleWeight).toBe(13);
		ready[2]!.plan.executionMode = 'production'; expect(allocateWorkdayCapacity({ now, remainingSeconds: 8, workdays: ready })).toEqual(result);
		for (const scale of [0.5, 2, 10]) {
			const scaled = ready.map(value => ({ ...value, plan: { ...value.plan, policySnapshot: { ...value.plan.policySnapshot,
				allocationWeight: value.plan.policySnapshot.allocationWeight * scale } } }));
			expect(Object.values(allocateWorkdayCapacity({ now, remainingSeconds: 8, workdays: scaled })).map(value => value.availableSeconds)).toEqual([0, 1, 7]);
		}
		expect(workdays).toEqual(before);
	});
	it('redistributes idle supply across weighted workdays without resizing prior commitments or changing execution mode entitlement', () => {
		const inputs = { now: '2026-10-03T00:00:20.000Z', remainingSeconds: 12, workdays: [
			{ plan: plan('busy', 2), committedSeconds: 6, planningCommittedSeconds: 2, maximumAdditionalSeconds: 12, actingReady: true },
			{ plan: plan('idle'), committedSeconds: 0, planningCommittedSeconds: 0, maximumAdditionalSeconds: 0, actingReady: false }] };
		const before = structuredClone(inputs), allocated = allocateWorkdayCapacity(inputs);
		expect(allocated.busy).toMatchObject({ availableSeconds: 12, committedSeconds: 6, phase: 'acting' });
		expect(allocated.idle?.availableSeconds).toBe(0); expect(inputs).toEqual(before);
		inputs.workdays[0]!.plan.executionMode = 'production'; expect(allocateWorkdayCapacity(inputs).busy?.availableSeconds).toBe(12);
	});
	it('denies future planned and ended work while preserving the initial planning boundary and exact final deadline', () => {
		const active = plan('active');
		const run = (now: string) => allocateWorkdayCapacity({ now, remainingSeconds: 10, workdays: [
			{ plan: active, committedSeconds: 0, planningCommittedSeconds: 0, maximumAdditionalSeconds: 10, actingReady: true }] }).active;
		expect(run('2026-10-02T23:59:59.999Z')?.availableSeconds).toBe(0);
		expect(run('2026-10-03T00:00:11.999Z')?.phase).toBe('planning');
		expect(run('2026-10-03T00:00:12.000Z')?.phase).toBe('acting');
		expect(run(active.endsAt)).toMatchObject({ availableSeconds: 0, phase: 'ended' });
		for (const state of ['planned', 'ended'] as const) expect(allocateWorkdayCapacity({ now: active.startsAt, remainingSeconds: 10,
			workdays: [{ plan: { ...active, state }, committedSeconds: 0, planningCommittedSeconds: 0, maximumAdditionalSeconds: 10, actingReady: true }] }).active?.availableSeconds).toBe(0);
	});
	it('selects underserved projects then classes and stable old ready nodes without changing input or depending on permutation', () => {
		const nodes = [{ id: 'first-author', projectId: 'first', agentClass: 'author', readyAt: '2026-10-03T00:00:00Z' },
			{ id: 'first-verifier', projectId: 'first', agentClass: 'verifier', readyAt: '2026-10-03T00:00:01Z' },
			{ id: 'second-author', projectId: 'second', agentClass: 'author', readyAt: '2026-10-03T00:00:00Z' }];
		const usage = [{ projectId: 'second', agentClass: 'author', seconds: 20 }, { projectId: 'first', agentClass: 'author', seconds: 10 }];
		const before = structuredClone({ nodes, usage, policy });
		expect(selectFairReadyNode(nodes, usage, policy)?.id).toBe('first-verifier');
		expect(selectFairReadyNode([...nodes].reverse(), [...usage].reverse(), policy)).toEqual(selectFairReadyNode(nodes, usage, policy));
		expect({ nodes, usage, policy }).toEqual(before); expect(selectFairReadyNode([], usage, policy)).toBeNull();
	});
	it('compiles each collaborative cycle from all prior contributors without inventing a fixed global number of cycles', () => {
		const agents = ['configured/a', 'configured/b', 'configured/c'], before = [...agents];
		const first = compilePlanningRounds('workday', agents, 3, 1), next = compilePlanningRounds('workday', agents, 3, 2);
		expect(first.every(turn => turn.dependsOn.length === 0)).toBe(true);
		for (const turn of next) expect(turn.dependsOn).toEqual(first.map(previous => previous.id));
		expect(next.map(turn => turn.agentId)).toEqual(agents); expect(agents).toEqual(before);
	});
	it('retains every hard supply profile provider and productive-window boundary without adding a minimum estimate', () => {
		const input = { estimate: { expectedSeconds: 2, maximumSeconds: 3 }, measurements: [],
			constraints: [{ id: 'original-deadline', remainingSeconds: 2 }, { id: 'shared-supply', remainingSeconds: 9 }],
			providerMaximumSeconds: 3, profileMaximumSeconds: 3, planningTurnMaximumSeconds: 3 };
		const before = structuredClone(input); expect(calculateAssignmentAllocation(input)).toMatchObject({ admitted: true, allocatedSeconds: 2, limitingConstraint: 'original-deadline' });
		expect(input).toEqual(before); expect(input.estimate).not.toHaveProperty('minimumSeconds');
		expect(calculateAssignmentAllocation({ ...input, constraints: [{ id: 'exhausted', remainingSeconds: 0 }] })).toMatchObject({ admitted: false, allocatedSeconds: 0 });
	});
	it('denies invalid supply duplicate shares malformed clocks and impossible planning commitments without usable allocation', () => {
		const workday = { plan: plan('same'), committedSeconds: 1, planningCommittedSeconds: 0, maximumAdditionalSeconds: 3, actingReady: true };
		const values = [{ now: 'malformed', remainingSeconds: 3, workdays: [workday] },
			{ now: workday.plan.startsAt, remainingSeconds: Number.NaN, workdays: [workday] },
			{ now: workday.plan.startsAt, remainingSeconds: 3, workdays: [workday, workday] },
			{ now: workday.plan.startsAt, remainingSeconds: 3, workdays: [{ ...workday, planningCommittedSeconds: 2 }] }];
		const outcomes = values.map(value => { try { allocateWorkdayCapacity(value); return 'admitted'; } catch { return 'denied'; } });
		expect(outcomes).toEqual(['denied', 'denied', 'denied', 'denied']);
	});
});
