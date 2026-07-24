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
it('models readiness, synthesis eligibility, proxy handles, and fallback quotas as pure contracts', () => {
		const scopeHash = computeDecisionScopeHash({ decisionId: 'decision-1', files: ['a.ts', 'b.ts'] });
		expect(scopeHash).toMatch(/^scope_[a-f0-9]+$/u);
		const readiness = {
			executionReadiness: 'ready',
			planningInputsStatus: 'complete',
		} as const;
		expect(isDecisionReadyForActing(readiness)).toBe(true);
		expect(isDecisionReadyForActing({ executionReadiness: 'blocked', planningInputsStatus: 'complete' })).toBe(false);

		const capacityEnvelope = {
			teamId: 'team-1',
			projectId: 'project-1',
			mode: 'acting',
			projectAgentClassId: 'class-1',
			capacityProviderId: 'provider-1',
		} as const;
		const decisionInput = {
			teamId: 'team-1',
			projectId: 'project-1',
			projectAgentClassId: 'class-1',
			mode: 'acting',
			capacity: capacityEnvelope,
			input: { decisionId: 'decision-1' },
		} as const;
		expect(isProviderAssignmentCandidateEligible({
			teamId: 'team-1',
			projectId: 'project-1',
			capacityProviderId: 'provider-1',
			projectAgentClassId: 'class-1',
			mode: 'acting',
			source: 'approved_decision',
			sourceId: 'input-1',
			synthesisKey: 'acting:input-1:provider-1',
			readiness: {
				id: 'status-1',
				teamId: 'team-1',
				projectId: 'project-1',
				decisionId: 'decision-1',
				executionReadiness: 'ready',
				planningInputsStatus: 'complete',
				scopeHash,
			},
			capacityEnvelope,
			decisionInput,
		})).toBe(true);
		expect(validateTreeDxProxyHandle({
			id: 'handle-1',
			teamId: 'team-1',
			projectId: 'project-1',
			assignmentId: 'assignment-1',
			scopes: ['files:read'],
		}, { teamId: 'team-1', projectId: 'project-1', assignmentId: 'assignment-1' })).toBeNull();
		expect(validateTreeDxProxyHandle({
			id: 'handle-2',
			teamId: 'team-1',
			projectId: 'other-project',
			scopes: ['files:read'],
		}, { teamId: 'team-1', projectId: 'project-1' })).toMatchObject({
			code: 'assignment_treedx_proxy_scope_invalid',
			retryable: false,
		});
		expect(evaluateFallbackQuota({ existingCount: 2, quota: 2 })).toMatchObject({
			code: 'assignment_fallback_quota_exceeded',
			retryable: true,
		});
	});

it('compiles execution capability demand from agent, class, decision, assignment, and work package', () => {
		const demand = compileExecutionCapabilityDemand({
			agent: {
				execution: {
					allowedPaths: ['docs/**'],
					forbiddenPaths: ['.env*'],
					maxConcurrency: 1,
					timeoutSeconds: 60,
					cooldownSeconds: 0,
					leaseSeconds: 60,
					retryLimit: 1,
					branchPrefix: 'agent',
					providerProfile: {
						requiredCapabilities: ['planning', 'repo_read'],
						preferredExecutionProviders: [{ provider: 'codex', weight: 80 }],
						acceptableFallbacks: [],
						fallbackPolicy: 'fail_if_unavailable',
					},
				},
				outputs: {
					messageTypes: ['task_complete'],
					modelMutations: ['knowledge_update'],
				},
			},
			projectAgentClass: { requiredCapabilities: ['human_review'] },
			decisionInput: {
				mode: 'acting',
				input: { requiredCapabilities: ['repo_write'] },
				metadata: { requiredCapabilities: ['qa_validation'] },
			},
			capacityEnvelope: {
				mode: 'acting',
				metadata: { requiredCapabilities: ['workflow_dispatch'] },
			},
			workUnit: {
				requiredCapabilities: ['release_gate'],
				metadata: { requiredCapabilities: ['verification'] },
			},
			assignment: {
				mode: 'acting',
				allowedOutputs: { types: ['assignment_summary'] },
				workspaceContext: {
					externalIssueKey: 'JIRA-123',
					externalJobId: 'job-123',
				},
				metadata: { requiredCapabilities: ['project_context'] },
				capabilityHandles: {
					workspaceAccessMode: 'brokered_workspace',
					repository: [{
						id: 'repo-handle',
						kind: 'repository_access',
						teamId: 'team-1',
						projectId: 'project-1',
						assignmentId: 'assignment-1',
						scopes: ['repo:read'],
						operations: ['read'],
						allowedPaths: ['docs/**'],
					}],
					workflowOperations: [{
						id: 'workflow-handle',
						kind: 'workflow_operation',
						teamId: 'team-1',
						projectId: 'project-1',
						assignmentId: 'assignment-1',
						scopes: ['workflow:dispatch'],
						operations: ['dispatch_workflow'],
						operationId: 'verify',
						repository: 'treeseed/project',
						workflowFile: '.github/workflows/verify.yml',
					}],
					secrets: [{
						id: 'secret-handle',
						kind: 'secret_use',
						teamId: 'team-1',
						projectId: 'project-1',
						assignmentId: 'assignment-1',
						scopes: ['secret:use'],
						operations: ['use'],
						secretClasses: ['github_actions'],
					}],
				},
			},
			workPackage: {
				kind: 'implementation',
				title: 'Implement docs',
				summary: 'Implement docs.',
				instructions: 'Update docs.',
				context: {},
				expectedOutputs: [{ type: 'pr_link', required: true }],
				constraints: {
					mode: 'acting',
					requiredCapabilities: ['implementation'],
					allowedPaths: ['src/**'],
					forbiddenPaths: ['secrets/**'],
				},
			},
		});

		expect(demand.required).toEqual([
			'human_review',
			'implementation',
			'planning',
			'project_context',
			'qa_validation',
			'release_gate',
			'repo_read',
			'repo_write',
			'verification',
			'workflow_dispatch',
		]);
		expect(demand.outputTypes).toEqual(['assignment_summary', 'knowledge_update', 'pr_link', 'task_complete']);
		expect(demand.resourceNeeds?.map((need) => need.kind)).toEqual(['repository', 'workflow', 'secret', 'external_issue', 'external_job']);
		expect(demand.metadata).toMatchObject({
			allowedPaths: ['docs/**', 'src/**'],
			forbiddenPaths: ['.env*', 'secrets/**'],
		});
		expect(demand.required).not.toContain('docs/**');
	});

it('compiles execution capability supply from descriptor, provider records, sessions, grants, and pressure', () => {
		const supply = compileExecutionCapabilitySupply({
			capacityProviderId: 'provider-1',
			descriptor: {
				id: 'codex',
				kind: 'ai_model',
				capabilities: ['planning', 'repo_read'],
				capabilityAliases: ['large_reasoning_model'],
				nativeUnit: 'token_or_wall_minute',
				quotaVisibility: 'partial',
				maxConcurrentAssignments: 2,
				supportsAsync: false,
				supportsCancel: false,
				supportsResume: false,
				supportsUsage: false,
				supportsArtifacts: false,
			},
			executionProvider: {
				schemaVersion: 1,
				id: 'execution-1',
				providerId: 'provider-1',
				displayName: 'Codex',
				adapter: 'codex',
				status: 'active',
				capabilities: ['repo_write'],
				nativeUnit: 'wall_minute',
				quotaVisibility: 'exact',
				maxConcurrentRunners: 4,
				nativeLimits: [],
				metadata: {
					capabilityAliases: ['large_reasoning_model'],
				},
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			} as never,
			availabilitySession: {
				id: 'session-1',
				membershipId: 'membership-1',
				teamId: 'team-1',
				providerId: 'provider-1',
				status: 'open',
				sequence: 1,
				snapshot: {
					sequence: 1,
					availableFrom: '2026-01-01T00:00:00.000Z',
					pressure: 'busy',
					maxConcurrentAssignments: 4,
					activeAssignmentIds: [],
					executionProviders: [],
					capabilities: ['verification'],
				},
				openedAt: '2026-01-01T00:00:00.000Z',
				refreshedAt: '2026-01-01T00:00:00.000Z',
				expiresAt: '2026-01-01T00:05:00.000Z',
			} as never,
			providerCapabilities: ['qa_validation'],
			checkInCapabilities: ['human_review'],
			grants: [{
				id: 'grant-1',
				status: 'active',
			} as never],
		});

		expect(supply).toMatchObject({
			capacityProviderId: 'provider-1',
			executionProviderId: 'execution-1',
			kind: 'ai_model',
			aliases: ['large_reasoning_model'],
			grants: ['grant-1'],
			pressure: 'busy',
			maxConcurrentAssignments: 2,
			nativeUnit: 'token_or_wall_minute',
			quotaVisibility: 'partial',
		});
		expect(supply.capabilities).toEqual(['codex', 'human_review', 'planning', 'qa_validation', 'repo_read', 'repo_write', 'verification']);
	});
});
