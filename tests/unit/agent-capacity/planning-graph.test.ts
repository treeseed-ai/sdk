import { describe,expect,it } from 'vitest';
import { compileAgentPlanningGraph,evaluatePlanningGraphNode,evaluatePlanningGraphNodeInstances } from '../../../src/agent-capacity/planning-graph.ts';

const profile = (agentId: string, activityType: string, input: string[] = [], output: string[] = [], producerPolicy: 'any' | 'all' = 'any') => ({
	agentId, activityType,
	signals: {
		subscribesTo: input.map((contract) => ({ contract, producerPolicy })),
		publishes: output,
	},
});

describe('agent planning graph', () => {
	it('derives a concise DAG from profile contracts and selects exact predecessor evidence', () => {
		const graph = compileAgentPlanningGraph([
			profile('researcher', 'planning', [], ['planning-note']),
			profile('reviewer', 'planning', [], ['planning-note']),
			profile('steward', 'planning', ['planning-note'], ['planning-proposal'], 'all'),
		]);
		expect(graph.ok).toBe(true);
		expect(graph.edges.map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`)).toEqual([
			'researcher:planning->steward:planning',
			'reviewer:planning->steward:planning',
		]);
		const partial = evaluatePlanningGraphNode(graph, 'steward:planning', [{
			nodeId: 'researcher:planning', references: [{ contractId: 'planning_note', recordId: 'signal:research' }],
		}]);
		expect(partial.ready).toBe(false);
		const ready = evaluatePlanningGraphNode(graph, 'steward:planning', [
			...partial.matched.map((entry) => entry),
			{ nodeId: 'researcher:planning', references: [{ contractId: 'planning-note', recordId: 'signal:research' }] },
			{ nodeId: 'reviewer:planning', references: [{ contractId: 'planning-note', recordId: 'signal:review' }] },
		]);
		expect(ready.ready).toBe(true);
		expect(ready.matched.map((entry) => entry.nodeId)).toEqual(['researcher:planning', 'reviewer:planning']);
	});

	it('fails closed for missing producers and cycles', () => {
		const missing = compileAgentPlanningGraph([profile('steward', 'planning', ['planning-note'], ['planning-proposal'])]);
		expect(missing.diagnostics[0]?.code).toBe('missing_producer');
		const cycle = compileAgentPlanningGraph([
			profile('one', 'planning', ['beta'], ['alpha']),
			profile('two', 'planning', ['alpha'], ['beta']),
		]);
		expect(cycle.diagnostics.some((diagnostic) => diagnostic.code === 'cycle')).toBe(true);
	});

	it('enforces repository signal publisher, subscriber, and filter contracts', () => {
		const contract = { schemaVersion: 'treeseed.agent-signal/v1' as const, id: 'proposal-submitted', label: 'Proposal submitted', description: 'A typed proposal entered deliberation.', subjectKinds: ['proposal'], allowedOrigins: ['agent-tool' as const], payloadSchema: {}, filterableFields: ['proposalTypes'], commitEvidence: 'required' as const, allowedProducerClasses: ['steward'], subscriberActivityProfiles: ['reviewing'], idempotency: 'commit-subject' as const, supersession: 'replace-subject' as const, coalescing: 'latest-subject' as const };
		const graph = compileAgentPlanningGraph([
			{ agentId: 'author', agentClass: 'writer', activityType: 'planning', signals: { publishes: ['proposal-submitted'] } },
			{ agentId: 'reviewer', agentClass: 'reviewer', activityType: 'estimating', signals: { subscribesTo: [{ contract: 'proposal-submitted', filters: { unknown: true } }] } },
		], { contracts: { 'proposal-submitted': contract } });
		expect(graph.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining(['publisher_not_allowed', 'subscriber_not_allowed', 'filter_not_allowed']));
	});

	it('fans evaluation nodes out once for each durable signal subject', () => {
		const graph = compileAgentPlanningGraph([
			profile('steward', 'planning', [], ['planning-proposal']),
			{ agentId: 'reviewer', activityType: 'reviewing', signals: { subscribesTo: [{ contract: 'planning-proposal', cardinality: 'each' as const }], publishes: ['proposal-feedback'] } },
		]);
		const evidence = [{ nodeId: 'steward:planning', references: [
			{ contractId: 'planning-proposal', recordId: 'signal:one', subjectId: 'proposal:one', metadata: { assignmentId: 'one' } },
			{ contractId: 'planning-proposal', recordId: 'signal:two', subjectId: 'proposal:two', metadata: { assignmentId: 'two' } },
		] }];
		expect(evaluatePlanningGraphNodeInstances(graph, 'reviewer:reviewing', evidence).map((instance) => instance.instanceKey)).toEqual([
			'proposal:one', 'proposal:two',
		]);
	});
});
