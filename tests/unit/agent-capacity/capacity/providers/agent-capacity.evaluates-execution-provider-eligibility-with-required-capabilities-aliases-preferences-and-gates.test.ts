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
it('evaluates execution provider eligibility with required capabilities, aliases, preferences, and gates', () => {
		const demand = {
			required: ['planning', 'repo_read'],
			preferred: ['fast_start'],
			mode: 'planning' as const,
		};
		const supply = {
			capacityProviderId: 'provider-1',
			executionProviderId: 'execution-1',
			kind: 'ai_model',
			capabilities: ['planning'],
			aliases: ['repo_read'],
			grants: [],
		};

		expect(evaluateExecutionProviderEligibility({ demand, supply })).toMatchObject({
			eligible: true,
			missingCapabilities: [],
			preferredCapabilities: ['fast_start'],
		});
		expect(evaluateExecutionProviderEligibility({
			demand: { ...demand, required: ['planning', 'repo_write'] },
			supply,
		})).toMatchObject({
			eligible: false,
			missingCapabilities: ['repo_write'],
			reasonCodes: ['missing_capability:repo_write'],
		});
		expect(evaluateExecutionProviderEligibility({
			demand,
			supply: { ...supply, pressure: 'exhausted' },
		})).toMatchObject({
			eligible: false,
			reasonCodes: ['runner_pressure_blocked'],
		});
		expect(evaluateExecutionProviderEligibility({
			demand,
			supply,
			gates: { readinessAllows: false },
		})).toMatchObject({
			eligible: false,
			reasonCodes: ['readiness_blocked'],
		});
	});

it('builds assignment explanations with capability demand supply and blocked candidate reasons', () => {
		const demand = {
			required: ['planning', 'repo_write'],
			preferred: ['verification'],
			mode: 'acting' as const,
		};
		const supply = {
			capacityProviderId: 'provider-1',
			executionProviderId: 'execution-1',
			kind: 'human_issue_queue',
			capabilities: ['planning'],
			aliases: [],
			grants: ['grant-1'],
		};
		const eligibility = evaluateExecutionProviderEligibility({
			demand,
			supply,
			gates: { readinessAllows: false },
		});
		const explanation = buildExecutionProviderAssignmentExplanation({
			source: 'approved_decision',
			sourceId: 'input-1',
			demand,
			supply,
			eligibility,
			grantId: 'grant-1',
			grantScope: 'project',
			readinessGate: { status: 'blocked' },
			allocationBudgetGate: { status: 'ok' },
			capabilityHandleGate: { status: 'not_issued' },
		});

		expect(explanation).toMatchObject({
			eligible: false,
			reasons: ['missing_capability:repo_write', 'readiness_blocked'],
			grantScope: 'project',
			gates: {
				requiredCapabilities: ['planning', 'repo_write'],
				availableCapabilities: ['planning'],
				missingCapabilities: ['repo_write'],
				selectedProvider: 'provider-1',
				selectedExecutionProvider: 'execution-1',
				executionProviderKind: 'human_issue_queue',
				grantId: 'grant-1',
				readinessGate: { status: 'blocked' },
			},
		});
	});

it('rejects assignments whose execution capability explanation does not cover demand', () => {
		const baseAssignment = {
			id: 'assignment-capabilities',
			teamId: 'team-1',
			projectId: 'project-1',
			capacityProviderId: 'provider-1',
			projectAgentClassId: 'class-1',
			mode: 'planning',
			status: 'leased',
			leaseState: 'leased',
			leaseExpiresAt: '2026-01-01T12:05:00.000Z',
			agentId: 'planner',
			capacityEnvelope: {
				teamId: 'team-1',
				projectId: 'project-1',
				mode: 'planning',
				capacityProviderId: 'provider-1',
				reservationId: 'reservation-planning-1',
				reservedCredits: 1,
			},
			decisionInput: {
				teamId: 'team-1',
				projectId: 'project-1',
				projectAgentClassId: 'class-1',
				mode: 'planning',
				agentId: 'planner',
				input: {},
			},
		} as const;
		const projectAgentClass = {
			id: 'class-1',
			teamId: 'team-1',
			projectId: 'project-1',
			slug: 'planner',
			name: 'Planner',
			status: 'active',
			allowedModes: ['planning'],
			requiredCapabilities: ['repo_read'],
			kernelProfile: { allowedModes: ['planning'] },
			kernelPolicy: {},
			handlerRefs: {},
			outputContracts: {},
		} as const;

		expect(validateAgentKernelModeExecutionInput({
			assignment: baseAssignment,
			projectAgentClass,
			now: '2026-01-01T12:00:00.000Z',
		})).toMatchObject({
			code: 'assignment_eligibility_capability_mismatch',
			metadata: {
				missingCapabilities: ['repo_read'],
				source: 'execution_capability_eligibility',
			},
		});
		expect(validateAgentKernelModeExecutionInput({
			assignment: {
				...baseAssignment,
				explanation: {
					gates: {
						availableCapabilities: ['repo_read'],
					},
				},
			},
			projectAgentClass,
			now: '2026-01-01T12:00:00.000Z',
		})).toBeNull();
		expect(validateAgentKernelModeExecutionInput({
			assignment: {
				...baseAssignment,
				explanation: {
					gates: {
						aliasCapabilities: ['repo_read'],
					},
				},
			},
			projectAgentClass,
			now: '2026-01-01T12:00:00.000Z',
		})).toBeNull();
	});

it('builds durable capacity-plan work units from accepted execution inputs', () => {
		const capacity = {
			teamId: 'team-1',
			projectId: 'project-1',
			mode: 'acting',
			projectAgentClassId: 'class-1',
			workDayId: 'workday-1',
		} as const;
		const plan = buildAgentCapacityPlanDraft({
			id: 'plan-1',
			teamId: 'team-1',
			projectId: 'project-1',
			decisionId: 'decision-1',
			scopeHash: 'scope_abc',
			workDayId: 'workday-1',
			executionInputs: [{
				id: 'input-1',
				teamId: 'team-1',
				projectId: 'project-1',
				decisionId: 'decision-1',
				projectAgentClassId: 'class-1',
				mode: 'acting',
				status: 'accepted',
				scopeHash: 'scope_abc',
				input: {
					teamId: 'team-1',
					projectId: 'project-1',
					projectAgentClassId: 'class-1',
					mode: 'acting',
					workGraphNodeId: 'graph-1:node:implementation',
					agentId: 'implementer',
					capacity,
					input: {
						objective: 'ship it',
						estimate: { expectedCredits: 3, highCredits: 5, confidence: 0.8 },
						requiredCapabilities: ['repo_write'],
						dependencies: ['plan-a'],
						assumptions: ['tests pass'],
					},
				},
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			}],
			now: '2026-01-01T00:00:00.000Z',
		});
		expect(plan).toMatchObject({
			id: 'plan-1',
			status: 'draft',
			expectedCredits: 3,
			highCredits: 5,
			capabilityNeeds: ['repo_write'],
			workUnits: [expect.objectContaining({
				id: 'plan-1:wu:1',
				decisionExecutionInputId: 'input-1',
				workGraphNodeId: 'graph-1:node:implementation',
				agentId: 'implementer',
				expectedCredits: 3,
				highCredits: 5,
			})],
		});
	});

it('rejects acting capacity-plan work without explicit graph-node provenance', () => {
		expect(() => buildAgentCapacityPlanDraft({
			id: 'plan-1', teamId: 'team-1', projectId: 'project-1', decisionId: 'decision-1', scopeHash: 'scope-1',
			executionInputs: [{
				id: 'input-1', teamId: 'team-1', projectId: 'project-1', decisionId: 'decision-1',
				projectAgentClassId: 'class-1', mode: 'acting', status: 'accepted', scopeHash: 'scope-1',
				input: {
					teamId: 'team-1', projectId: 'project-1', projectAgentClassId: 'class-1', mode: 'acting',
					capacity: { teamId: 'team-1', projectId: 'project-1', mode: 'acting' }, input: {},
				},
			}],
		})).toThrow('Acting decision execution input input-1 requires workGraphNodeId provenance.');
	});
});
