import { describe, expect, it } from 'vitest';
import { compilePlanningRounds, compileWorkday, selectFairReadyNode, workdayPolicySchema, workdayPhase } from '../../../../src/capacity/agents/agent-capacity.ts';

const policy = workdayPolicySchema.parse({ durationSeconds: 28_800, maximumConcurrency: 8,
	planningPercent: 20, planningTurnMaximumSeconds: 180, communicationConcurrency: 1,
	projectPercentages: { sdk: 60, api: 40 }, agentClassPercentages: { sdk: { engineer: 60, reviewer: 40 } } });

describe('minimal workday allocation', () => {
	it('starts estimating with one cycle, not a fixed two-round contract', () => {
		const workday = compileWorkday({ id: 'estimates', teamId: 'team', policyId: 'default', policyRevision: 1,
			executionMode: 'simulation', policy, agentIds: ['sdk/engineer:estimating', 'sdk/reviewer:estimating'],
			activityTypes: ['estimating'], startsAt: '2026-09-13T12:00:00.000Z' });
		expect(workday.planningRounds[0]?.assignmentIds).toHaveLength(2);
		expect(workday.planningRounds).toHaveLength(1);
	});
	it('creates one deterministic cycle and can compile successive collaboration turns', () => {
		const result = compilePlanningRounds('workday-1', ['sdk/tester', 'sdk/architect', 'sdk/tester'], 900);
		expect(result.map((entry) => entry.id)).toEqual([
			'planning:workday-1:1:sdk/architect', 'planning:workday-1:1:sdk/tester',
		]);
		expect(compilePlanningRounds('workday-1', ['sdk/architect', 'sdk/tester'], 180, 3)[0]?.dependsOn)
			.toEqual(['planning:workday-1:2:sdk/architect', 'planning:workday-1:2:sdk/tester']);
	});

	it('uses one deterministic compiler for the complete applied workday', () => {
		const workday = compileWorkday({ id: 'workday', teamId: 'team', policyId: 'default', policyRevision: 1,
			executionMode: 'simulation', policy, agentIds: ['sdk/tester', 'sdk/architect'], startsAt: '2026-09-13T12:00:00.000Z' });
		expect(workday).toMatchObject({ state: 'planned', executionMode: 'simulation', startsAt: '2026-09-13T12:00:00.000Z',
			endsAt: '2026-09-13T20:00:00.000Z', planningRounds: [
				{ round: 1, assignmentIds: ['planning:workday:1:sdk/architect', 'planning:workday:1:sdk/tester'] },
			] });
	});
	it('uses a percentage-based phase boundary and rejects retired policy fields', () => {
		const workday = compileWorkday({ id: 'w', teamId: 'team', policyId: 'default', policyRevision: 1,
			executionMode: 'simulation', policy: { ...policy, durationSeconds: 1000 }, agentIds: ['sdk/architect'], startsAt: '2026-09-13T12:00:00Z' });
		expect(workdayPhase(workday, '2026-09-13T12:03:19Z')).toBe('planning');
		expect(workdayPhase(workday, '2026-09-13T12:03:20Z')).toBe('acting');
		expect(workdayPhase(workday, workday.endsAt)).toBe('ended');
		expect(workdayPolicySchema.safeParse({ ...policy, planningSecondsPerAgent: 900 }).success).toBe(false);
	});

	it('selects project then class by weighted deficit and uses stable node ties', () => {
		const nodes = [
			{ id: 'sdk-review', projectId: 'sdk', agentClass: 'reviewer', graphPriority: 1, readyAt: '2026-09-13T12:00:00Z' },
			{ id: 'sdk-engineer', projectId: 'sdk', agentClass: 'engineer', graphPriority: 2, readyAt: '2026-09-13T12:00:01Z' },
			{ id: 'api-engineer', projectId: 'api', agentClass: 'engineer', graphPriority: 1, readyAt: '2026-09-13T12:00:00Z' },
		];
		expect(selectFairReadyNode(nodes, [{ projectId: 'api', agentClass: 'engineer', seconds: 120 }], policy)).toMatchObject({
			id: 'sdk-engineer', explanation: { projectTargetPercent: 60, projectDeficitSeconds: 72, classTargetPercent: 60,
				classDeficitSeconds: 0, readyNodeCount: 3 } });
		expect(selectFairReadyNode(nodes, [{ projectId: 'sdk', agentClass: 'engineer', seconds: 600 }], policy)?.id).toBe('api-engineer');
	});
});
