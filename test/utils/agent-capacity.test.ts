import { describe, expect, it } from 'vitest';
import {
	deriveAgentCapacityEnvelopeFromReservation,
	deriveAgentCapacityEnvelopeFromAssignment,
	deriveAllocationSetFromCapacityGrants,
	deriveDecisionExecutionInputFromAssignment,
	deriveModeRunUsageSettlement,
	deriveProviderAvailabilitySession,
	buildExecutionProviderAssignmentExplanation,
	buildAgentCapacityPlanDraft,
	compileDecisionAssignmentGraphFromEstimates,
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
} from '../../src/agent-capacity.ts';

describe('agent capacity contracts', () => {
	it('derives generic capacity records from existing capacity primitives', () => {
		const grant = {
			id: 'grant-1',
			capacityProviderId: 'provider-1',
			laneId: 'lane-1',
			grantScope: 'project',
			teamId: 'team-1',
			projectId: 'project-1',
			environment: 'staging',
			state: 'active',
			dailyCreditLimit: 12,
			weeklyCreditLimit: null,
			monthlyCreditLimit: 120,
			dailyUsdLimit: null,
			weeklyQuotaMinutes: null,
			monthlyProviderUnits: null,
			portfolioAllocationPercent: 60,
			priorityWeight: 2,
			overflowPolicy: 'approval_required',
			metadata: { source: 'test' },
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		} as const;

		const allocationSet = deriveAllocationSetFromCapacityGrants({
			id: 'allocation-1',
			teamId: 'team-1',
			grants: [grant],
			now: '2026-01-01T00:00:00.000Z',
		});
		expect(allocationSet).toMatchObject({
			id: 'allocation-1',
			teamId: 'team-1',
			status: 'draft',
			slices: [{
				projectId: 'project-1',
				capacityProviderId: 'provider-1',
				percent: 60,
			}],
		});

		const session = deriveProviderAvailabilitySession({
			id: 'session-1',
			provider: {
				id: 'provider-1',
				teamId: 'team-1',
				ownerTeamId: 'team-1',
				name: 'Local Provider',
				kind: 'team_owned',
				status: 'online',
				provider: '@treeseed/agent',
				billingScope: 'team',
				monthlyCreditBudget: 100,
				dailyCreditBudget: 10,
				maxConcurrentWorkdays: 1,
				maxConcurrentWorkers: 1,
				capacityModel: {},
				capabilities: ['agent_execution'],
				metadata: { lastHealth: { activeWorkers: 0 } },
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
			grants: [grant],
			now: '2026-01-01T00:00:00.000Z',
		});
		expect(session).toMatchObject({
			id: 'session-1',
			capacityProviderId: 'provider-1',
			status: 'open',
			capabilities: ['agent_execution'],
			grants: [expect.objectContaining({ id: 'grant-1' })],
		});
	});

	it('derives assignment envelopes and mode-run usage settlement snapshots', () => {
		const envelope = deriveAgentCapacityEnvelopeFromReservation({
			mode: 'planning',
			projectAgentClassId: 'class-1',
			allocationSetId: 'allocation-1',
			reservation: {
				id: 'reservation-1',
				capacityProviderId: 'provider-1',
				executionProviderId: 'exec-1',
				laneId: 'lane-1',
				teamId: 'team-1',
				projectId: 'project-1',
				workDayId: 'workday-1',
				taskId: null,
				state: 'reserved',
				reservedCredits: 5,
				consumedCredits: 0,
				nativeUnit: 'wall_minute',
				reservedNativeAmount: 30,
				consumedNativeAmount: null,
				reservedProviderUnits: null,
				consumedProviderUnits: null,
				reservedUsd: null,
				consumedUsd: null,
				expiresAt: null,
				metadata: {},
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		});
		expect(envelope).toMatchObject({
			mode: 'planning',
			projectAgentClassId: 'class-1',
			allocationSetId: 'allocation-1',
			reservationId: 'reservation-1',
			reservedCredits: 5,
		});

		const settlement = deriveModeRunUsageSettlement({
			id: 'usage-1',
			taskId: null,
			workDayId: 'workday-1',
			projectId: 'project-1',
			taskSignature: 'agent.planning',
			executionProfileId: 'standard-code-model',
			capacityProviderId: 'provider-1',
			executionProviderId: 'exec-1',
			laneId: 'lane-1',
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
			taskUsageActualId: 'usage-1',
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
						preferredLanes: [{ provider: 'codex', weight: 80 }],
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
				capabilityAliases: ['codex_subscription'],
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
				id: 'execution-1',
				kind: 'codex_subscription',
				nativeUnit: 'wall_minute',
				quotaVisibility: 'exact',
				maxConcurrentWorkers: 4,
				metadata: {
					capabilities: ['repo_write'],
					capabilityAliases: ['large_reasoning_model'],
				},
				config: {},
			} as never,
			availabilitySession: {
				id: 'session-1',
				status: 'open',
				checkedInAt: '2026-01-01T00:00:00.000Z',
				capabilities: ['verification'],
				runnerPressure: { pressure: 'busy' },
			} as never,
			providerCapabilities: ['qa_validation'],
			checkInCapabilities: ['human_review'],
			grants: [{
				id: 'grant-1',
				state: 'active',
				grantScope: 'project',
			} as never],
		});

		expect(supply).toMatchObject({
			capacityProviderId: 'provider-1',
			executionProviderId: 'execution-1',
			kind: 'ai_model',
			aliases: ['codex_subscription', 'large_reasoning_model'],
			grants: ['grant-1'],
			pressure: 'busy',
			maxConcurrentAssignments: 2,
			nativeUnit: 'token_or_wall_minute',
			quotaVisibility: 'partial',
		});
		expect(supply.capabilities).toEqual(['codex_subscription', 'human_review', 'planning', 'qa_validation', 'repo_read', 'repo_write', 'verification']);
	});

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
				decisionExecutionInputId: 'input-1',
				agentId: 'implementer',
				expectedCredits: 3,
				highCredits: 5,
			})],
		});
	});

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
			assignment: { synthesizedFrom: 'fixture', metadata: {} } as any,
		})).toBe(false);
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
		}).ok).toBe(true);
	});

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
});
