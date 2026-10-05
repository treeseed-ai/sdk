import { describe, expect, it } from 'vitest';
import { compilePlanningRounds, compileWorkday, executionNodeSchema, selectFairReadyNode, workdayPolicySchema, workdayPhase } from '../../../../src/capacity/agents/agent-capacity.ts';

const policy = workdayPolicySchema.parse({ durationSeconds: 28_800, maximumConcurrency: 8,
	planningPercent: 20, planningTurnMaximumSeconds: 180, communicationConcurrency: 1,
	projectPercentages: { sdk: 60, api: 40 }, agentClassPercentages: { sdk: { engineer: 60, reviewer: 40 } } });

describe('minimal workday allocation', () => {
	it('validates one canonical integer node priority without coercion and retains omission as zero selection rather than another authority', () => {
		const node = { schemaVersion: 'treeseed.execution-node/v1', id: 'ready-node', teamId: 'team', projectId: 'sdk', kind: 'acting', pairRole: null,
			sourceRef: { store: 'treedx', model: 'proposal', id: 'proposal', repository: 'sdk-library', commit: 'a'.repeat(40), path: 'proposals/proposal.mdx' },
			ruleRevision: 1, nodeRevision: 1, agentClass: 'engineer', status: 'ready', estimate: { expectedSeconds: 1, maximumSeconds: 1 },
			requiredCapabilities: [], requestedPermissions: { content: { read: [], write: [] }, tools: [] }, workspace: 'read-only', graphRevisionCreated: 1, graphRevisionUpdated: 1 };
		const before = structuredClone(node); expect(executionNodeSchema.parse(node)).toEqual(node);
		for (const priority of [Number.MIN_SAFE_INTEGER, -1, 0, 1, Number.MAX_SAFE_INTEGER]) {
			const input = { ...node, priority }, held = structuredClone(input);
			expect(executionNodeSchema.parse(input)).toEqual(input); expect(input).toEqual(held);
		}
		for (const priority of [null, '', '1', false, true, [], {}, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
			const input = { ...node, priority }, held = structuredClone(input);
			expect(executionNodeSchema.safeParse(input).success).toBe(false); expect(input).toEqual(held);
		}
		expect(node).toEqual(before); expect(Object.hasOwn(node, 'priority')).toBe(false);
	});
	it('selects higher canonical graph priority only after project and class fairness then uses oldest readiness and stable identity without changing eligible inputs', () => {
		const nodes = [
			{ id: 'sdk-old', projectId: 'sdk', agentClass: 'engineer', readyAt: '2026-09-13T12:00:00Z' },
			{ id: 'sdk-priority', projectId: 'sdk', agentClass: 'engineer', readyAt: '2026-09-13T12:00:02Z', priority: 1 },
			{ id: 'sdk-review', projectId: 'sdk', agentClass: 'reviewer', readyAt: '2026-09-13T12:00:00Z', priority: Number.MAX_SAFE_INTEGER },
			{ id: 'api-priority', projectId: 'api', agentClass: 'engineer', readyAt: '2026-09-13T12:00:00Z', priority: Number.MAX_SAFE_INTEGER },
		];
		const usage = [{ projectId: 'api', agentClass: 'engineer', seconds: 120 }], held = structuredClone({ nodes, usage, policy });
		for (const input of [nodes, [...nodes].reverse(), [nodes[2]!, nodes[1]!, nodes[3]!, nodes[0]!]]) {
			expect(selectFairReadyNode(input, usage, policy)).toMatchObject({ id: 'sdk-priority', priority: 1,
				explanation: { projectTargetPercent: 60, projectDeficitSeconds: 72, classTargetPercent: 60, classDeficitSeconds: 0, readyNodeCount: 4 } });
		}
		const tied = nodes.filter(node => node.agentClass === 'engineer' && node.projectId === 'sdk').map(node => ({ ...node, priority: 0 }));
		expect(selectFairReadyNode(tied, [], policy)?.id).toBe('sdk-old');
		const identities = tied.map(node => ({ ...node, readyAt: '2026-09-13T12:00:00Z' }));
		expect(selectFairReadyNode([...identities].reverse(), [], policy)?.id).toBe('sdk-old');
		expect(selectFairReadyNode(nodes, [{ projectId: 'sdk', agentClass: 'engineer', seconds: 600 }], policy)?.id).toBe('api-priority');
		for (const priority of [null, '', '1', false, true, [], {}, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			const input = nodes.map(node => Object.assign({}, node, { priority })), before = structuredClone(input);
			expect(() => selectFairReadyNode(input, usage, policy)).toThrow(); expect(input).toEqual(before);
		}
		expect({ nodes, usage, policy }).toEqual(held);
	});
	it('retains exact eligible selector inputs in the existing selection explanation so later admission history can be replayed without reconstructing candidates', () => {
		const nodes = [{ id: 'selected', projectId: 'sdk', agentClass: 'engineer', readyAt: '2026-09-13T12:00:00Z' },
			{ id: 'other', projectId: 'api', agentClass: 'engineer', readyAt: '2026-09-13T12:00:00Z' }];
		const usage = [{ projectId: 'api', agentClass: 'engineer', seconds: 120 }], held = structuredClone({ nodes, usage, policy });
		const retained = { nodes: [...held.nodes].sort((left, right) => left.id.localeCompare(right.id)), usage: held.usage };
		const selected = selectFairReadyNode(nodes, usage, policy);
		expect(selected).toMatchObject({ id: 'selected', input: retained });
		expect({ nodes, usage, policy }).toEqual(held);
		nodes[0]!.id = 'changed-after-selection'; usage[0]!.seconds = 0;
		expect(selected).toMatchObject({ id: 'selected', input: retained });
		// SAME original selection stored in the existing allocation explanation,
		// not a second receipt, authority, stored policy or eligibility oracle.
	});
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
	it('uses the percentage as a minimum planning window and returns to planning when acting has no ready work', () => {
		const workday = compileWorkday({ id: 'w', teamId: 'team', policyId: 'default', policyRevision: 1,
			executionMode: 'simulation', policy: { ...policy, durationSeconds: 1000 }, agentIds: ['sdk/architect'], startsAt: '2026-09-13T12:00:00Z' });
		expect(workdayPhase(workday, '2026-09-13T12:03:19Z', true)).toBe('planning');
		expect(workdayPhase(workday, '2026-09-13T12:03:20Z', true)).toBe('acting');
		expect(workdayPhase(workday, '2026-09-13T12:03:20Z', false)).toBe('planning');
		expect(workdayPhase(workday, '2026-09-13T12:03:21Z', true)).toBe('acting');
		expect(workdayPhase(workday, workday.endsAt, false)).toBe('ended');
		expect(workdayPolicySchema.safeParse({ ...policy, planningSecondsPerAgent: 900 }).success).toBe(false);
	});

	it('selects project then class by weighted deficit and uses stable node ties', () => {
		const nodes = [
			{ id: 'sdk-review', projectId: 'sdk', agentClass: 'reviewer', readyAt: '2026-09-13T12:00:00Z' },
			{ id: 'sdk-engineer', projectId: 'sdk', agentClass: 'engineer', readyAt: '2026-09-13T12:00:01Z' },
			{ id: 'api-engineer', projectId: 'api', agentClass: 'engineer', readyAt: '2026-09-13T12:00:00Z' },
		];
		expect(selectFairReadyNode(nodes, [{ projectId: 'api', agentClass: 'engineer', seconds: 120 }], policy)).toMatchObject({
			id: 'sdk-engineer', explanation: { projectTargetPercent: 60, projectDeficitSeconds: 72, classTargetPercent: 60,
				classDeficitSeconds: 0, readyNodeCount: 3 } });
		expect(selectFairReadyNode(nodes, [{ projectId: 'sdk', agentClass: 'engineer', seconds: 600 }], policy)?.id).toBe('api-engineer');
	});
});
