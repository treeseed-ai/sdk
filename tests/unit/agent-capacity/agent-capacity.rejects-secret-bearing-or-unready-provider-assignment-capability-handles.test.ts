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
it('rejects secret-bearing or unready provider assignment capability handles', () => {
		const baseAssignment = {
			id: 'assignment-8',
			teamId: 'team-1',
			projectId: 'project-1',
			capacityProviderId: 'provider-1',
			projectAgentClassId: 'class-1',
			mode: 'planning',
			status: 'leased',
			leaseState: 'leased',
			agentId: 'planner',
			decisionInput: { input: {} },
			capacityEnvelope: { teamId: 'team-1', projectId: 'project-1', mode: 'planning', capacityProviderId: 'provider-1' },
		} as const;

		expect(validateProviderAssignmentCapabilityHandles({
			assignment: {
				...baseAssignment,
				capabilityHandles: {
					workspaceAccessMode: 'brokered_workspace',
					repository: [{
						id: 'repo-handle-secret',
						kind: 'repository_access',
						teamId: 'team-1',
						projectId: 'project-1',
						assignmentId: 'assignment-8',
						operations: ['read'],
						githubInstallationToken: 'ghs_nope',
					}],
				},
			},
		})).toMatchObject({ code: 'assignment_capability_handle_secret_material', retryable: false });

		expect(validateProviderAssignmentCapabilityHandles({
			assignment: {
				...baseAssignment,
				capabilityHandles: {
					workspaceAccessMode: 'context_only',
					repository: [{
						id: 'repo-handle-write',
						kind: 'repository_access',
						teamId: 'team-1',
						projectId: 'project-1',
						assignmentId: 'assignment-8',
						operations: ['write'],
					}],
				},
			},
		})).toMatchObject({ code: 'assignment_capability_handle_write_not_ready' });
	});

it('summarizes assignment execution visibility from lifecycle output', () => {
		const summary = summarizeExecutionProviderVisibility({
			assignment: {
				id: 'assignment-visibility-1',
				status: 'returned',
				capacityProviderId: 'provider-1',
				executionProviderId: 'jira',
				lifecycleOutput: {
					status: 'waiting',
					externalRef: 'TS-12',
					externalUrl: 'https://jira.example.test/browse/TS-12',
					metadata: {
						executionStatus: 'blocked',
						blockerReason: 'Needs product clarification.',
						usage: [{ kind: 'jira_time_spent', unit: 'second', amount: 120 }],
						artifacts: [{ kind: 'external_issue', name: 'TS-12' }],
					},
				},
			},
		});

		expect(summary).toMatchObject({
			executionProviderId: 'jira',
			adapterStatus: 'blocked',
			externalRef: 'TS-12',
			externalUrl: 'https://jira.example.test/browse/TS-12',
			blockerReason: 'Needs product clarification.',
			usage: [{ kind: 'jira_time_spent', unit: 'second', amount: 120 }],
			artifacts: [{ kind: 'external_issue', name: 'TS-12' }],
		});
	});

it('summarizes mode-run execution visibility from outputs and trace refs', () => {
		const summary = summarizeExecutionProviderVisibility({
			modeRun: {
				id: 'mode-run-1',
				executionProviderId: 'workflow',
				status: 'succeeded',
				outputs: {
					status: 'completed',
					externalRef: 'run-123',
					externalUrl: 'https://github.example.test/runs/123',
					usage: [{ kind: 'runner_minutes', unit: 'minute', amount: 2 }],
					artifacts: [{ kind: 'workflow_logs', name: 'logs' }],
				},
				traceRefs: {
					externalRef: 'trace-fallback',
					externalUrl: 'https://example.test/fallback',
				},
			},
		});

		expect(summary).toMatchObject({
			executionProviderId: 'workflow',
			adapterStatus: 'completed',
			externalRef: 'run-123',
			externalUrl: 'https://github.example.test/runs/123',
			usage: [{ kind: 'runner_minutes', unit: 'minute', amount: 2 }],
			artifacts: [{ kind: 'workflow_logs', name: 'logs' }],
		});
	});

it('summarizes capability match details from assignment explanation gates', () => {
		const explanation = buildExecutionProviderAssignmentExplanation({
			source: 'capacity_plan',
			sourceId: 'plan-1',
			demand: {
				mode: 'acting',
				required: ['planning', 'repo_read'],
				preferred: ['verification'],
			},
			supply: {
				capacityProviderId: 'provider-1',
				executionProviderId: 'codex',
				kind: 'ai_model',
				capabilities: ['planning'],
				aliases: ['repo_read'],
				grants: ['grant-1'],
			},
			eligibility: evaluateExecutionProviderEligibility({
				demand: {
					mode: 'acting',
					required: ['planning', 'repo_read'],
					preferred: ['verification'],
				},
				supply: {
					capacityProviderId: 'provider-1',
					executionProviderId: 'codex',
					kind: 'ai_model',
					capabilities: ['planning'],
					aliases: ['repo_read'],
					grants: ['grant-1'],
				},
			}),
			grantId: 'grant-1',
			grantScope: 'project',
		});
		const summary = summarizeExecutionProviderVisibility({ explanation });

		expect(summary).toMatchObject({
			requiredCapabilities: ['planning', 'repo_read'],
			preferredCapabilities: ['verification'],
			availableCapabilities: ['planning'],
			aliasCapabilities: ['repo_read'],
			missingCapabilities: [],
			selectedProvider: 'provider-1',
			selectedExecutionProvider: 'codex',
			executionProviderKind: 'ai_model',
			capabilityEligible: true,
			reasonCodes: [],
		});
	});

it('decorates old records with empty execution visibility instead of throwing', () => {
		const decorated = decorateExecutionProviderVisibility({ id: 'old-assignment', status: 'queued' });

		expect(decorated.executionVisibility).toMatchObject({
			executionProviderId: null,
			executionProviderKind: null,
			adapterStatus: 'queued',
			externalRef: null,
			externalUrl: null,
			usage: [],
			artifacts: [],
			requiredCapabilities: [],
			availableCapabilities: [],
			missingCapabilities: [],
			capabilityEligible: null,
			reasonCodes: [],
		});
	});

it('validates structured estimates with dependency declarations', () => {
		const estimate = {
			id: 'estimate-1',
			teamId: 'team-1',
			projectId: 'project-1',
			decisionId: 'decision-1',
			agentClass: 'engineer',
			minCredits: 2,
			expectedCredits: 4,
			maxCredits: 6,
			confidence: 'medium',
			riskLevel: 'low',
			assumptions: ['Architecture spec covers API shape.'],
			blockers: [],
			dependencies: [{
				id: 'dep-architecture',
				type: 'artifact',
				requiredBefore: 'start',
				deliverableType: 'architecture_spec',
				agentClass: 'architect',
				summary: 'Approved architecture spec is required before implementation.',
			}, {
				id: 'dep-human',
				type: 'human-input',
				requiredBefore: 'start',
				humanInputPolicy: { requiredFrom: 'team-human', teamId: 'team-1' },
				summary: 'Team member must resolve rollout objective.',
			}],
			expectedOutputs: [{ outputType: 'code_change', required: true }],
			acceptanceCriteria: ['Implementation passes staged tests.'],
			completionEvidence: ['Changed files and test output.'],
		} as const;

		expect(validateStructuredAgentEstimate(estimate).ok).toBe(true);
		expect(validateStructuredAgentEstimate({ ...estimate, minCredits: -1 }).diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'non_negative_number_required', path: 'minCredits' }),
		]));
	});

it('validates deliverable contracts and manifests without concrete file paths in the contract', () => {
		expect(validateDeliverableContract({
			id: 'contract-1',
			teamId: 'team-1',
			projectId: 'project-1',
			decisionId: 'decision-1',
			deliverableType: 'architecture_spec',
			producerAgentClasses: ['architect'],
			acceptanceCriteria: ['Covers API, data model, and migration risk.'],
			status: 'required',
		}).ok).toBe(true);

		expect(validateDeliverableManifest({
			id: 'manifest-1',
			deliverableContractId: 'contract-1',
			projectId: 'project-1',
			decisionId: 'decision-1',
			producedRefs: [{
				model: 'note',
				collection: 'notes',
				slug: 'architecture/decision-1',
			}],
			summary: 'Architecture spec was produced as a linked note.',
			readyForReview: true,
			sourceAuthority: {
				assignmentId: 'assignment-1', modeRunId: 'mode-run-1', baseRef: '0123456789abcdef',
				effectiveRef: 'fedcba9876543210', checkpointCommit: 'fedcba9876543210',
			},
		}).ok).toBe(true);
		expect(validateDeliverableManifest({
			id: 'manifest-1', deliverableContractId: 'contract-1', projectId: 'project-1', decisionId: 'decision-1',
			producedRefs: [{ model: 'note', collection: 'notes', slug: 'architecture/decision-1' }], summary: 'Invalid source lineage.', readyForReview: true,
			sourceAuthority: { assignmentId: 'assignment-1', modeRunId: 'mode-run-1', baseRef: 'main', effectiveRef: 'fedcba9876543210' },
		}).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'deliverable_source_ref_invalid', path: 'sourceAuthority.baseRef' })]));
	});
});
