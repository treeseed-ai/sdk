import { describe, expect, it } from 'vitest';
import {
	deriveAgentCapacityEnvelopeFromReservation,
	deriveAgentCapacityEnvelopeFromAssignment,
	deriveAllocationSetFromCapacityGrants,
	deriveDecisionExecutionInputFromAssignment,
	deriveModeRunUsageSettlement,
	deriveProviderAvailabilitySession,
	buildAgentCapacityPlanDraft,
	computeDecisionScopeHash,
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
	treeDxProxyHeaders,
	redactedProviderAssignmentCapabilityHandles,
	validateProviderAssignmentCapabilityHandles,
	validateAgentKernelOutputs,
	validateTreeDxProxyHandle,
	validateAgentKernelModeExecutionInput,
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
});
