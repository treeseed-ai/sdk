import { describe, expect, it } from 'vitest';
import { compilePlanningRounds, compileWorkday, selectFairReadyNode, workdayPolicySchema } from '../../../../src/capacity/agents/agent-capacity.ts';

const policy = workdayPolicySchema.parse({ durationSeconds: 28_800, maximumConcurrency: 8,
	planningSecondsPerAgent: 900, communicationConcurrency: 1,
	projectWeights: { sdk: 4, api: 2 }, agentClassWeights: { engineer: 4, reviewer: 2 } });

describe('minimal workday allocation', () => {
	it('creates exactly two deterministic planning rounds for every eligible agent', () => {
		const result = compilePlanningRounds('workday-1', ['sdk/tester', 'sdk/architect', 'sdk/tester'], 900);
		expect(result.map((entry) => entry.id)).toEqual([
			'planning:workday-1:1:sdk/architect', 'planning:workday-1:1:sdk/tester',
			'planning:workday-1:2:sdk/architect', 'planning:workday-1:2:sdk/tester',
		]);
		expect(result[2]?.dependsOn).toEqual(['planning:workday-1:1:sdk/architect', 'planning:workday-1:1:sdk/tester']);
	});

	it('uses one deterministic compiler for the complete applied workday', () => {
		const workday = compileWorkday({ id: 'workday', teamId: 'team', policyId: 'default', policyRevision: 1,
			executionMode: 'simulation', policy, agentIds: ['sdk/tester', 'sdk/architect'], startsAt: '2026-09-13T12:00:00.000Z' });
		expect(workday).toMatchObject({ state: 'planned', executionMode: 'simulation', startsAt: '2026-09-13T12:00:00.000Z',
			endsAt: '2026-09-13T20:00:00.000Z', planningRounds: [
				{ round: 1, assignmentIds: ['planning:workday:1:sdk/architect', 'planning:workday:1:sdk/tester'] },
				{ round: 2, assignmentIds: ['planning:workday:2:sdk/architect', 'planning:workday:2:sdk/tester'] },
			] });
	});

	it('selects project then class by weighted deficit and uses stable node ties', () => {
		const nodes = [
			{ id: 'sdk-review', projectId: 'sdk', agentClass: 'reviewer', graphPriority: 1, readyAt: '2026-09-13T12:00:00Z' },
			{ id: 'sdk-engineer', projectId: 'sdk', agentClass: 'engineer', graphPriority: 2, readyAt: '2026-09-13T12:00:01Z' },
			{ id: 'api-engineer', projectId: 'api', agentClass: 'engineer', graphPriority: 1, readyAt: '2026-09-13T12:00:00Z' },
		];
		expect(selectFairReadyNode(nodes, [{ projectId: 'api', agentClass: 'engineer', seconds: 120 }], policy)?.id).toBe('sdk-engineer');
		expect(selectFairReadyNode(nodes, [{ projectId: 'sdk', agentClass: 'engineer', seconds: 600 }], policy)?.id).toBe('api-engineer');
	});
});
