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
it('selects kernel modes, validates outputs, and builds proxy request headers', () => {
		expect(selectAgentKernelModeDecision({
			planningReady: 1,
			actingReady: 2,
			planningBudgetCredits: 10,
			actingBudgetCredits: 1,
		})).toMatchObject({ kind: 'mode', mode: 'acting', reason: 'acting_queue_ready' });
		expect(selectAgentKernelModeDecision({
			planningReady: 1,
			actingReady: 0,
			planningBudgetCredits: 10,
		})).toMatchObject({ kind: 'mode', mode: 'planning' });
		expect(selectAgentKernelModeDecision({ fallbackReady: 1 })).toMatchObject({ kind: 'fallback' });
		expect(selectAgentKernelModeDecision({})).toMatchObject({ kind: 'idle' });

		expect(validateAgentKernelOutputs({
			mode: 'acting',
			outputs: { status: 'completed', metadata: { type: 'proposal_draft' } },
			allowedOutputs: { statuses: ['completed'], types: ['proposal_draft'] },
		})).toEqual({ ok: true });
		expect(validateAgentKernelOutputs({
			mode: 'acting',
			outputs: { status: 'completed', metadata: { type: 'unscoped_mutation' } },
			allowedOutputs: { types: ['proposal_draft'] },
		})).toMatchObject({ ok: false });

		expect(treeDxProxyHeaders({
			id: 'tdx-handle-1',
			teamId: 'team-1',
			projectId: 'project-1',
			assignmentId: 'assignment-1',
			scopes: ['workspace:read'],
		})).toEqual({
			'x-treeseed-assignment-id': 'assignment-1',
			'x-treeseed-treedx-proxy-handle-id': 'tdx-handle-1',
		});
		expect(isAgentCapacityPlanStaleOrSuperseded({ status: 'accepted', scopeHash: 'scope_a' }, 'scope_b')).toBe(true);
		expect(isAgentCapacityPlanStaleOrSuperseded({ status: 'superseded', scopeHash: 'scope_a' }, 'scope_a')).toBe(true);
		expect(isAgentCapacityPlanStaleOrSuperseded({ status: 'accepted', scopeHash: 'scope_a' }, 'scope_a')).toBe(false);
	});

it('enforces TreeDX proxy handle operation scope and acting capacity-plan provenance', () => {
		const handle = {
			id: 'tdx-1',
			teamId: 'team-1',
			projectId: 'project-1',
			assignmentId: 'assignment-1',
			repositoryId: 'repo-1',
			workspaceId: 'workspace-1',
			scopes: ['project:read'],
			allowedOperations: ['files:read'],
			allowedPaths: ['docs/**'],
			expiresAt: '2099-01-01T00:00:00.000Z',
		};
		expect(evaluateTreeDxProxyHandleAccess(handle, {
			teamId: 'team-1',
			projectId: 'project-1',
			assignmentId: 'assignment-1',
			repositoryId: 'repo-1',
			workspaceId: 'workspace-1',
			operation: 'files:read',
			path: 'docs/intro.md',
		})).toMatchObject({ ok: true });
		expect(evaluateTreeDxProxyHandleAccess(handle, {
			teamId: 'team-1',
			projectId: 'project-1',
			assignmentId: 'assignment-1',
			repositoryId: 'repo-2',
			operation: 'files:read',
			path: 'docs/intro.md',
		})).toMatchObject({ ok: false, code: 'treedx_proxy_repository_mismatch' });
		expect(evaluateTreeDxProxyHandleAccess(handle, {
			teamId: 'team-1',
			projectId: 'project-1',
			assignmentId: 'assignment-1',
			repositoryId: 'repo-1',
			operation: 'files:write',
			path: 'docs/intro.md',
		})).toMatchObject({ ok: false, code: 'treedx_proxy_operation_denied' });
		expect(evaluateTreeDxProxyHandleAccess(handle, {
			teamId: 'team-1',
			projectId: 'project-1',
			assignmentId: 'assignment-1',
			repositoryId: 'repo-1',
			operation: 'files:read',
			path: 'src/private.ts',
		})).toMatchObject({ ok: false, code: 'treedx_proxy_path_denied' });

		expect(hasAcceptedCapacityPlanProvenance({
			assignment: {
				synthesizedFrom: 'capacity_plan',
				metadata: { capacityPlanId: 'plan-1', capacityPlanStatus: 'accepted' },
			} as any,
		})).toBe(true);
		expect(hasAcceptedCapacityPlanProvenance({
			assignment: { synthesizedFrom: 'fallback_queue', metadata: {} } as any,
		})).toBe(false);
	});

it('applies distinct TreeDX proxy read and write path scopes', () => {
		const handle = {
			id: 'tdx-path-scope',
			teamId: 'team-1',
			projectId: 'project-1',
			assignmentId: 'assignment-1',
			scopes: ['project:read', 'project:write'],
			allowedOperations: ['files:read', 'files:write', 'git:commit'],
			allowedPaths: ['**'],
			allowedReadPaths: ['**'],
			allowedWritePaths: ['src/content/**'],
		};
		expect(evaluateTreeDxProxyHandleAccess(handle, {
			projectId: 'project-1', assignmentId: 'assignment-1', operation: 'files:read', path: 'README.md',
		})).toMatchObject({ ok: true });
		expect(evaluateTreeDxProxyHandleAccess(handle, {
			projectId: 'project-1', assignmentId: 'assignment-1', operation: 'files:write', path: 'README.md',
		})).toMatchObject({ ok: false, code: 'treedx_proxy_path_denied' });
		expect(evaluateTreeDxProxyHandleAccess(handle, {
			projectId: 'project-1', assignmentId: 'assignment-1', operation: 'files:write', path: 'src/content/notes/result.md',
		})).toMatchObject({ ok: true });
	});

it('validates provider assignment capability handles without exposing secrets', () => {
		const assignment = {
			id: 'assignment-7',
			teamId: 'team-1',
			projectId: 'project-1',
			capacityProviderId: 'provider-1',
			projectAgentClassId: 'class-1',
			mode: 'acting',
			status: 'leased',
			leaseState: 'leased',
			leaseExpiresAt: '2099-01-01T00:00:00.000Z',
			agentId: 'engineer',
			synthesizedFrom: 'capacity_plan',
			metadata: { capacityPlanId: 'plan-1', capacityPlanStatus: 'accepted' },
			decisionInput: {
				teamId: 'team-1',
				projectId: 'project-1',
				projectAgentClassId: 'class-1',
				mode: 'acting',
				capacity: {},
				input: {},
				metadata: { capacityPlanId: 'plan-1', capacityPlanStatus: 'accepted' },
			},
			capacityEnvelope: {
				teamId: 'team-1',
				projectId: 'project-1',
				mode: 'acting',
				capacityProviderId: 'provider-1',
				reservationId: 'reservation-1',
				reservedCredits: 1,
				metadata: { capacityPlanId: 'plan-1', capacityPlanStatus: 'accepted' },
			},
			capabilityHandles: {
				workspaceAccessMode: 'brokered_workspace',
				repository: [{
					id: 'repo-handle-1',
					kind: 'repository_access',
					teamId: 'team-1',
					projectId: 'project-1',
					assignmentId: 'assignment-7',
					workspaceAccessMode: 'brokered_workspace',
					operations: ['read', 'test'],
					repository: 'treeseed/project',
					credentialMode: 'brokered',
				}],
				workflowOperations: [{
					id: 'workflow-handle-1',
					kind: 'workflow_operation',
					teamId: 'team-1',
					projectId: 'project-1',
					assignmentId: 'assignment-7',
					workspaceAccessMode: 'brokered_workspace',
					operations: ['dispatch_workflow'],
					operationId: 'verify',
					repository: 'treeseed/project',
					workflowFile: '.github/workflows/verify.yml',
					ref: 'main',
					secretBearing: true,
				}],
				secrets: [{
					id: 'secret-use-1',
					kind: 'secret_use',
					teamId: 'team-1',
					projectId: 'project-1',
					assignmentId: 'assignment-7',
					operations: ['dispatch_workflow'],
					secretClasses: ['github_actions'],
					custodyMode: 'github_actions_secret_enclave',
					revealAllowed: false,
				}],
			},
		} as const;

		expect(validateProviderAssignmentCapabilityHandles({ assignment })).toBeNull();
		const governedBaseRef = '0123456789abcdef0123456789abcdef01234567';
		expect(validateProviderAssignmentCapabilityHandles({
			assignment: {
				...assignment,
				decisionInput: { ...assignment.decisionInput, input: { exactBaseRef: governedBaseRef } },
				capabilityHandles: {
					...assignment.capabilityHandles,
					repository: [{ ...assignment.capabilityHandles.repository[0], operations: ['read', 'write'], allowedRefs: ['different-ref'] }],
				},
			},
		})).toMatchObject({ code: 'assignment_repository_ref_scope_invalid', retryable: false });
		expect(validateProviderAssignmentCapabilityHandles({
			assignment: {
				...assignment,
				decisionInput: { ...assignment.decisionInput, input: { exactBaseRef: governedBaseRef } },
				capabilityHandles: {
					...assignment.capabilityHandles,
					repository: [{ ...assignment.capabilityHandles.repository[0], operations: ['read', 'write'], allowedRefs: [governedBaseRef] }],
				},
			},
		})).toBeNull();
		expect(validateAgentKernelModeExecutionInput({
			assignment,
			now: '2026-01-01T00:00:00.000Z',
			readiness: {
				id: 'readiness-1',
				teamId: 'team-1',
				projectId: 'project-1',
				decisionId: 'decision-1',
				executionReadiness: 'ready',
				planningInputsStatus: 'complete',
				scopeHash: 'scope-1',
			},
		})).toBeNull();

		const redacted = redactedProviderAssignmentCapabilityHandles({
			workspaceAccessMode: 'brokered_workspace',
			repository: [{ ...assignment.capabilityHandles.repository[0], token: 'ghs_should_not_survive' }],
		});
		expect(redacted.repository?.[0]).not.toHaveProperty('token');
	});
});
