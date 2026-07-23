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
} from '../../../src/agent-capacity.ts';
describe('agent capacity contracts', () => {
it('validates portable engineering workflow promotion configuration', () => {
		const valid = {
			schemaVersion: 1, id: 'engineering-a', projectId: 'project-a', decisionId: 'decision-a',
			objectiveId: 'objective-a', exactBaseRef: '0123456789abcdef',
			roles: { tester: 'testing', engineer: 'engineering', reviewer: 'review', technicalWriter: 'technical-writing', releaser: 'release' },
		};
		expect(validateEngineeringWorkflowPromotionConfig(valid)).toEqual({ ok: true, diagnostics: [] });
		expect(validateEngineeringWorkflowPromotionConfig({ ...valid, requireRevisionCycle: 'yes' })).toMatchObject({
			ok: false, diagnostics: [expect.objectContaining({ path: 'requireRevisionCycle' })],
		});
		expect(validateEngineeringWorkflowPromotionConfig({ ...valid, exactBaseRef: '', includeResearch: true })).toMatchObject({
			ok: false,
			diagnostics: expect.arrayContaining([
				expect.objectContaining({ path: 'exactBaseRef' }),
				expect.objectContaining({ path: 'roles.researcher' }),
			]),
		});
	});

it('derives mode-run usage settlement snapshots', () => {
		const settlement = deriveModeRunUsageSettlement({
			id: 'usage-1',
			taskId: null,
			workDayId: 'workday-1',
			projectId: 'project-1',
			taskSignature: 'agent.planning',
			executionProfileId: 'standard-code-model',
			capacityProviderId: 'provider-1',
			executionProviderId: 'exec-1',
			businessModel: 'subscription_quota',
			modelName: 'codex',
			inputTokens: null,
			outputTokens: null,
			cachedInputTokens: null,
			quotaMinutes: null,
			wallMinutes: 4,
			filesOpened: null,
			filesChanged: null,
			diffLinesAdded: null,
			diffLinesRemoved: null,
			testRuns: null,
			retryCount: null,
			actualCredits: 1.5,
			actualUsd: null,
			nativeUsage: { nativeUnit: 'wall_minute', amount: 4 },
			metadata: { capacityLedgerEntryId: 'ledger-1' },
			createdAt: '2026-01-01T00:00:00.000Z',
		});
		expect(settlement).toMatchObject({
			capacityUsageActualId: 'usage-1',
			capacityLedgerEntryId: 'ledger-1',
			actualCredits: 1.5,
		});
	});

it('identifies leasable and expired provider assignments', () => {
		const now = new Date('2026-01-01T12:00:00.000Z');
		expect(isProviderAssignmentLeasable({
			status: 'pending',
			leaseState: 'unleased',
			leaseExpiresAt: null,
		}, now)).toBe(true);
		expect(isProviderAssignmentLeasable({
			status: 'returned',
			leaseState: 'released',
			leaseExpiresAt: null,
		}, now)).toBe(true);
		expect(isProviderAssignmentLeaseExpired({
			leaseExpiresAt: '2026-01-01T11:59:00.000Z',
		}, now)).toBe(true);
		expect(isProviderAssignmentLeasable({
			status: 'leased',
			leaseState: 'leased',
			leaseExpiresAt: '2026-01-01T11:59:00.000Z',
		}, now)).toBe(true);
		expect(isProviderAssignmentLeasable({
			status: 'leased',
			leaseState: 'leased',
			leaseExpiresAt: '2026-01-01T12:01:00.000Z',
		}, now)).toBe(false);
	});

it('derives kernel mode execution inputs from provider assignments', () => {
		const assignment = {
			id: 'assignment-1',
			teamId: 'team-1',
				projectId: 'project-1',
				capacityProviderId: 'provider-1',
				projectAgentClassId: 'class-1',
				reservationId: 'reservation-1',
				mode: 'acting',
			status: 'leased',
			leaseState: 'leased',
			leaseExpiresAt: '2026-01-01T12:05:00.000Z',
			agentId: 'engineer',
			handlerId: 'engineer-handler',
			decisionInput: {
				input: { objective: 'ship the bounded work' },
				metadata: { source: 'test', capacityPlanId: 'plan-1', capacityPlanStatus: 'accepted' },
			},
			capacityEnvelope: {
				teamId: 'team-1',
				projectId: 'project-1',
					mode: 'acting',
					capacityProviderId: 'provider-1',
					reservationId: 'reservation-1',
					reservedCredits: 3,
					availableCredits: 5,
				limits: { wallMinutes: 20 },
				metadata: { capacityPlanId: 'plan-1', capacityPlanStatus: 'accepted' },
			},
		} as const;

		expect(deriveAgentCapacityEnvelopeFromAssignment(assignment)).toMatchObject({
			teamId: 'team-1',
			projectId: 'project-1',
			mode: 'acting',
			availableCredits: 5,
			limits: { wallMinutes: 20 },
		});
		expect(deriveDecisionExecutionInputFromAssignment(assignment)).toMatchObject({
			teamId: 'team-1',
			projectId: 'project-1',
			projectAgentClassId: 'class-1',
			mode: 'acting',
			agentId: 'engineer',
			handlerId: 'engineer-handler',
			input: { objective: 'ship the bounded work' },
		});
		expect(validateAgentKernelModeExecutionInput({
			assignment,
			projectAgentClass: {
				id: 'class-1',
				teamId: 'team-1',
				projectId: 'project-1',
				slug: 'engineer',
				name: 'Engineer',
				status: 'active',
				allowedModes: ['planning', 'acting'],
				requiredCapabilities: [],
				kernelProfile: { allowedModes: ['acting'] },
				kernelPolicy: {},
				handlerRefs: {},
				outputContracts: {},
			},
			readiness: {
				id: 'readiness-1',
				teamId: 'team-1',
				projectId: 'project-1',
				decisionId: 'decision-1',
				humanApprovalState: 'approved',
				executionReadiness: 'ready',
				planningInputsStatus: 'complete',
				scopeHash: 'scope-1',
			},
			now: '2026-01-01T12:00:00.000Z',
		})).toBeNull();
	});

it('rejects unsupported or expired kernel mode assignments with bounded fallback reasons', () => {
		const assignment = {
			id: 'assignment-2',
			teamId: 'team-1',
			projectId: 'project-1',
			capacityProviderId: 'provider-1',
			projectAgentClassId: 'class-1',
			mode: 'acting',
			status: 'leased',
			leaseState: 'leased',
			leaseExpiresAt: '2026-01-01T11:59:00.000Z',
			agentId: 'planner',
			decisionInput: { input: {} },
			capacityEnvelope: {
				teamId: 'team-1',
				projectId: 'project-1',
				mode: 'acting',
				capacityProviderId: 'provider-1',
			},
		} as const;

		expect(validateAgentKernelModeExecutionInput({
			assignment,
			now: '2026-01-01T12:00:00.000Z',
		})).toMatchObject({
			code: 'assignment_lease_expired',
			retryable: true,
		});
		expect(isAgentModeAllowedForClass('acting', {
			status: 'active',
			allowedModes: ['planning'],
		})).toBe(false);
		expect(validateAgentKernelModeExecutionInput({
			assignment: {
				...assignment,
				leaseExpiresAt: '2026-01-01T12:05:00.000Z',
			},
			projectAgentClass: {
				id: 'class-1',
				teamId: 'team-1',
				projectId: 'project-1',
				slug: 'planner',
				name: 'Planner',
				status: 'active',
				allowedModes: ['planning'],
				requiredCapabilities: [],
				kernelProfile: {},
				kernelPolicy: {},
				handlerRefs: {},
				outputContracts: {},
			},
			now: '2026-01-01T12:00:00.000Z',
		})).toMatchObject({
			code: 'assignment_mode_not_allowed',
			retryable: false,
		});
	});
});
