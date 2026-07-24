import { describe, expect, it } from 'vitest';

import {
	deriveAgentCapacityEnvelopeFromAssignment,
	deriveDecisionExecutionInputFromAssignment,
	deriveModeRunUsageSettlement,
	buildExecutionProviderAssignmentExplanation,
	buildAgentCapacityPlanDraft,
	activateDecisionAssignmentGraph,
	advanceDecisionAssignmentGraph,
	compileDecisionAssignmentGraphFromEstimates,
	compileEngineeringAssignmentGraph,
	compileEngineeringRevisionCycle,
	compileExecutionCapabilityDemand,
	compileExecutionCapabilitySupply,
	computeDecisionScopeHash,
	decorateExecutionProviderVisibility,
	evaluateExecutionProviderEligibility,
	evaluateFallbackQuota,
	evaluateTreeDxProxyHandleAccess,
	hasAcceptedCapacityPlanProvenance,
	isAgentCapacityPlanStaleOrSuperseded,
	isAgentModeAllowedForClass,
	isDecisionReadyForActing,
	isProviderAssignmentCandidateEligible,
	isProviderAssignmentLeasable,
	isProviderAssignmentLeaseExpired,
	selectAgentKernelModeDecision,
	summarizeExecutionProviderVisibility,
	treeDxProxyHeaders,
	redactedProviderAssignmentCapabilityHandles,
	validateProviderAssignmentCapabilityHandles,
	validateAgentKernelOutputs,
	validateTreeDxProxyHandle,
	validateAgentKernelModeExecutionInput,
	validateDeliverableContract,
	validateDeliverableManifest,
	validateStructuredAgentEstimate,
	validateEngineeringWorkflowPromotionConfig,
} from '../../../../../src/capacity/agents/agent-capacity.ts';
describe('agent capacity contracts', () => {
it('compiles deterministic decision assignment graphs from shuffled estimates', () => {
		const engineerEstimate = {
			id: 'estimate-engineer',
			teamId: 'team-1',
			projectId: 'project-1',
			decisionId: 'decision-1',
			agentClass: 'engineer',
			minCredits: 3,
			expectedCredits: 5,
			maxCredits: 8,
			confidence: 'high',
			riskLevel: 'medium',
			assumptions: [],
			blockers: [],
			dependencies: [{
				id: 'dep-architecture',
				type: 'artifact',
				requiredBefore: 'start',
				deliverableType: 'architecture_spec',
				agentClass: 'architect',
				summary: 'Architecture spec required.',
			}],
			expectedOutputs: [{ outputType: 'implementation_report', required: true }],
			acceptanceCriteria: ['Meets decision acceptance criteria.'],
			completionEvidence: ['Tests pass.'],
		} as const;
		const testerEstimate = {
			...engineerEstimate,
			id: 'estimate-tester',
			agentClass: 'tester',
			minCredits: 1,
			expectedCredits: 2,
			maxCredits: 3,
			dependencies: [{
				id: 'dep-human',
				type: 'human-input',
				requiredBefore: 'start',
				humanInputPolicy: { requiredFrom: 'team-human', teamId: 'team-1' },
				summary: 'Team confirms required performance target.',
			}],
			expectedOutputs: [{ outputType: 'test_report', required: true }],
		} as const;

		const first = compileDecisionAssignmentGraphFromEstimates({
			teamId: 'team-1',
			projectId: 'project-1',
			decisionId: 'decision-1',
			estimates: [testerEstimate, engineerEstimate],
			compiledAt: '2026-01-01T00:00:00.000Z',
		});
		const second = compileDecisionAssignmentGraphFromEstimates({
			teamId: 'team-1',
			projectId: 'project-1',
			decisionId: 'decision-1',
			estimates: [engineerEstimate, testerEstimate],
			compiledAt: '2026-01-01T00:00:00.000Z',
		});

		expect(first.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
		expect(first.graph).toEqual(second.graph);
		expect(first.graph.deliverableContracts).toEqual([expect.objectContaining({
			deliverableType: 'architecture_spec',
			producerAgentClasses: ['architect'],
		})]);
		expect(first.graph.edges).toEqual([expect.objectContaining({
			edgeType: 'blocks-start',
			reason: 'Architecture spec required.',
		})]);
		expect(first.graph.nodes.find((node) => node.targetAgentClass === 'tester')?.metadata).toMatchObject({
			humanInputDependencies: [expect.objectContaining({
				humanInputPolicy: { requiredFrom: 'team-human', teamId: 'team-1' },
			})],
		});
	});

it('compiles the canonical engineering graph in test-first dependency order', () => {
		const compiled = compileEngineeringAssignmentGraph({
			teamId: 'team-1',
			projectId: 'project-1',
			decisionId: 'decision-1',
			exactBaseRef: '0123456789abcdef',
			roles: {
				researcher: 'researcher',
				architect: 'architect',
				tester: 'tester',
				engineer: 'engineer',
				reviewer: 'reviewer',
				technicalWriter: 'technical-writer',
				releaser: 'releaser',
				operations: 'operations-runner',
			},
			includeResearch: true,
			includeArchitecture: true,
			compiledAt: '2026-01-01T00:00:00.000Z',
		});

		expect(compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
		expect(compiled.graph.status).toBe('compiled');
		expect(compiled.graph.nodes.map((node) => node.metadata?.stage)).toEqual([
			'research', 'architecture', 'test', 'implementation', 'verification', 'review', 'documentation', 'release', 'operations',
		]);
		expect(compiled.graph.edges.map((edge) => [
			compiled.graph.nodes.find((node) => node.id === edge.fromNodeId)?.metadata?.stage,
			compiled.graph.nodes.find((node) => node.id === edge.toNodeId)?.metadata?.stage,
		])).toEqual([
			['research', 'architecture'], ['architecture', 'test'], ['test', 'implementation'], ['implementation', 'verification'],
			['verification', 'review'], ['review', 'documentation'], ['documentation', 'release'], ['release', 'operations'],
		]);
		expect(compiled.graph.nodes.find((node) => node.metadata?.stage === 'implementation')?.metadata).toMatchObject({
			exactBaseRef: '0123456789abcdef',
			requiresFailingTestIntegrationRef: true,
			testMutationForbidden: true,
		});
		expect(compiled.graph.nodes.find((node) => node.metadata?.stage === 'test')?.metadata).toMatchObject({ implementationMutationForbidden: true });
		expect(compiled.graph.nodes.find((node) => node.metadata?.stage === 'review')?.metadata).toMatchObject({ rejectionCreatesRevision: true });
		expect(compiled.graph.nodes.find((node) => node.metadata?.stage === 'release')?.metadata).toMatchObject({ hostedReleaseFailClosed: true });
	});

it('blocks engineering graphs without an exact source ref', () => {
		const compiled = compileEngineeringAssignmentGraph({
			teamId: 'team-1', projectId: 'project-1', decisionId: 'decision-1', exactBaseRef: ' ',
			roles: { tester: 'tester', engineer: 'engineer', reviewer: 'reviewer', technicalWriter: 'technical-writer', releaser: 'releaser' },
		});

		expect(compiled.graph.status).toBe('blocked');
		expect(compiled.diagnostics).toContainEqual(expect.objectContaining({ code: 'engineering_exact_base_ref_required', severity: 'error' }));
	});

it('advances approved engineering deliverables and creates explicit review revision cycles', () => {
		const initial = compileEngineeringAssignmentGraph({
			teamId: 'team-1', projectId: 'project-1', decisionId: 'decision-1', exactBaseRef: 'abc123',
			roles: { tester: 'tester', engineer: 'engineer', reviewer: 'reviewer', technicalWriter: 'writer', releaser: 'releaser' },
		}).graph;
		const testContract = initial.deliverableContracts[0]!;
		const advanced = advanceDecisionAssignmentGraph(initial, testContract.id, new Set([testContract.id]));
		expect(advanced.nodes.map((node) => node.status)).toEqual(['completed', 'ready', 'pending', 'pending', 'pending', 'pending']);

		const reviewContract = initial.deliverableContracts.find((contract) => contract.deliverableType === 'review_decision')!;
		const revision = compileEngineeringRevisionCycle(initial, reviewContract.id, 'Implementation needs an edge-case correction.');
		expect(revision).not.toBeNull();
		expect(revision!.revisionCycle).toBe(1);
		expect(revision!.graph.nodes.slice(-3).map((node) => [node.metadata?.stage, node.status])).toEqual([
			['implementation', 'ready'], ['verification', 'pending'], ['review', 'pending'],
		]);
		expect(revision!.graph.nodes.find((node) => node.metadata?.stage === 'documentation')?.requiredDeliverableContractIds).toEqual([
			revision!.newContracts[2]!.id,
		]);
		expect(revision!.graph.edges).toContainEqual(expect.objectContaining({
			fromNodeId: revision!.graph.nodes.at(-1)!.id,
			toNodeId: revision!.graph.nodes.find((node) => node.metadata?.stage === 'documentation')!.id,
		}));
	});

it('activates only dependency-root graph nodes', () => {
		const graph = compileEngineeringAssignmentGraph({
			teamId: 'team-1', projectId: 'project-1', decisionId: 'decision-1', exactBaseRef: 'abc123',
			roles: { tester: 'tester', engineer: 'engineer', reviewer: 'reviewer', technicalWriter: 'writer', releaser: 'releaser' },
		}).graph;
		const activated = activateDecisionAssignmentGraph({ ...graph, nodes: graph.nodes.map((node) => ({ ...node, status: 'pending' })) });
		expect(activated.status).toBe('ready');
		expect(activated.nodes.map((node) => node.status)).toEqual(['ready', 'pending', 'pending', 'pending', 'pending', 'pending']);
	});
});
