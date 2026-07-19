import { MarketClient } from '../market-client.ts';
import { ProviderProtocolClient } from '../capacity-provider.ts';
import type { RunTreeseedLiveReconcileTestsOptions, TreeseedLiveReconcileEnvironment, TreeseedLiveReconcileProvider } from './live-acceptance.ts';
import { configuredLiveAcceptanceValue, type LiveAcceptanceEnv } from './live-acceptance-values.ts';
import { verifyCapacityAcceptanceTerminal } from './live-acceptance-capacity-terminal.ts';
import {
	assertCapacityAcceptancePolicyUnchanged,
	assertRevokedCapacityProviderAccess,
	capacityAcceptancePolicyFingerprint,
} from './live-acceptance-capacity-guards.ts';
import {
	capacityAcceptanceConfig,
	capacityGrantForAcceptance,
	createTreeDxProxyAuditEvidence,
	effectiveActiveAllocation,
	ensureLocalCapacityTreeDxBinding,
	provisionLocalCapacityAcceptanceProvider,
	resolveLocalCapacityAcceptanceScope,
	syncLocalAcceptanceAgentClass,
	type CapacityAcceptanceProof,
} from './live-acceptance-capacity-context.ts';
import { proveLocalCapacityGovernance } from './live-acceptance-capacity-governance.ts';
import { provisionLocalCapacityCompetition } from './live-acceptance-capacity-competition.ts';
import { closeCapacityAcceptanceAvailabilitySession, verifyCapacityAcceptanceCleanup } from './live-acceptance-capacity-cleanup.ts';
import { runLocalAutonomousStarterAcceptances } from './live-acceptance-starters.ts';
type LiveEnv = LiveAcceptanceEnv; const configuredValue = configuredLiveAcceptanceValue;
export async function runCapacityProviderAssignmentProof(input: {
	provider: TreeseedLiveReconcileProvider;
	environment: TreeseedLiveReconcileEnvironment;
	runId: string;
	prefix: string;
	env: LiveEnv;
	fetchImpl: typeof fetch;
	capacityAssignmentExecutor?: RunTreeseedLiveReconcileTestsOptions['capacityAssignmentExecutor'];
}): Promise<CapacityAcceptanceProof> {
	const config = capacityAcceptanceConfig(input.env, input.environment);
	if (config.missing.length > 0) throw new Error(`Missing capacity acceptance configuration: ${config.missing.join(', ')}.`);
	const runnerId = `${input.prefix}-runner`, assignmentId = `${input.prefix}-assignment`;
	const mode = configuredValue(input.env, ['TREESEED_CAPACITY_ACCEPTANCE_MODE']) || 'planning';
	const metadata = {
		liveAcceptance: true,
		runId: input.runId,
		prefix: input.prefix,
		provider: input.provider,
		capability: input.provider === 'railway' ? 'capacity-provider-runtime-assignment-proof' : 'capacity-provider-assignment-proof',
		priority: 1_000_000,
	};
	const adminClient = new MarketClient({
		profile: {
			id: 'capacity-acceptance',
			label: 'Capacity Acceptance',
			baseUrl: config.apiUrl,
			kind: 'specialized',
			teamId: config.teamId,
		},
		accessToken: config.adminToken,
		fetchImpl: input.fetchImpl,
		userAgent: `treeseed-live-acceptance/${input.runId}`,
	});
	if (input.environment === 'local') {
		Object.assign(config, await resolveLocalCapacityAcceptanceScope(adminClient, config.projectId));
		await ensureLocalCapacityTreeDxBinding(adminClient, config);
	}
	let cleanupProvisionedProvider: (() => Promise<unknown>) | null = null, cleanupGovernanceProof: (() => Promise<unknown>) | null = null;
	let cleanupCapacityCompetition: (() => Promise<unknown>) | null = null, governanceProof: CapacityAcceptanceProof['governance'], starterProofs: Pick<CapacityAcceptanceProof, 'starterPlanning' | 'starterEngineering'> | undefined;
	let governanceAcceptance: Awaited<ReturnType<typeof proveLocalCapacityGovernance>> | null = null, provisionedRuntime: Awaited<ReturnType<typeof provisionLocalCapacityAcceptanceProvider>> | null = null;
	if (input.environment === 'local' && (!config.providerId || !config.membershipId || !config.providerAccessToken)) {
		const provisioned = await provisionLocalCapacityAcceptanceProvider({
			adminClient, apiUrl: config.apiUrl, teamId: config.teamId, runId: input.runId, fetchImpl: input.fetchImpl,
		});
		Object.assign(config, provisioned);
		provisionedRuntime = provisioned;
		cleanupProvisionedProvider = provisioned.cleanup;
	}
	if (!config.providerId || !config.membershipId || !config.providerAccessToken) {
		throw new Error('Capacity acceptance provider identity, membership, and access token were not resolved.');
	}
	if (input.environment === 'local' && provisionedRuntime && input.capacityAssignmentExecutor) {
		governanceAcceptance = await proveLocalCapacityGovernance({
			adminClient,
			apiUrl: config.apiUrl,
			runId: input.runId,
			primaryTeamId: config.teamId,
			primaryMembershipId: config.membershipId,
			privateJwk: provisionedRuntime.privateJwk,
			fetchImpl: input.fetchImpl,
		});
		cleanupGovernanceProof = governanceAcceptance.cleanup;
	}
	const providerClient = new ProviderProtocolClient({
		marketUrl: config.apiUrl,
		accessToken: config.providerAccessToken,
		fetchImpl: input.fetchImpl,
		userAgent: `treeseed-live-acceptance/${input.runId}`,
	});
	let sessionIdForCleanup = '';
	let grantIdForCleanup = '';
	let workdayIdForCleanup = '';
	let workdayRunIdForCleanup = '';
	let completedAssignmentId = '';
	let humanPolicyFingerprint = '';
	const executionThroughAgentRuntime = Boolean(input.capacityAssignmentExecutor && provisionedRuntime);
	const agentClassId = executionThroughAgentRuntime ? 'testing' : config.agentClassId;
	try {
	let availabilitySession = await providerClient.createAvailabilitySession({
		id: `${input.prefix}-session`,
		environment: input.environment,
		status: 'open',
		capabilities: ['planning', 'repo_read', 'agent_mode_run', 'usage_report'],
		grants: [],
		nativeLimits: { availableCredits: 30, maxConcurrentRunners: 1, wallMinutes: { session: 30 } },
		runnerPressure: { activeRunners: 0, maxConcurrentRunners: 1 },
		constraints: { liveAcceptance: true, outboundOnly: true },
		metadata,
		executionProviders: [{
			id: 'acceptance-deterministic', adapter: 'deterministic_workflow', status: 'available',
			capabilities: ['planning', 'agent_mode_run', 'repo_read', 'usage_report'],
			maxConcurrentRunners: 1, activeRunners: 0, nativeLimits: { availableCredits: 30 }, lanes: [],
		}],
	});
	sessionIdForCleanup = String(availabilitySession.payload.id ?? '');
	if (executionThroughAgentRuntime && input.environment === 'local') {
		await syncLocalAcceptanceAgentClass(adminClient, { projectId: config.projectId, agentClassId, runId: input.runId });
	} else {
		const existingClasses = await adminClient.projectAgentClasses(config.projectId).catch(() => ({ payload: { items: [] } }));
		const hasAgentClass = existingClasses.payload.items.some((entry) => entry.id === agentClassId || entry.slug === agentClassId);
		if (!hasAgentClass) {
		await adminClient.createProjectAgentClass(config.projectId, {
			id: agentClassId,
			slug: agentClassId,
			name: 'Planning',
			status: 'active',
			allowedModes: ['planning'],
			requiredCapabilities: ['agent_mode_run'],
			metadata,
		}, `live-acceptance:${input.runId}:agent-class:${agentClassId}`);
		}
	}
	const grants = await adminClient.capacityGrants(config.teamId, { limit: 200 }).catch(() => ({ payload: { items: [] } }));
	let acceptanceGrant = capacityGrantForAcceptance(Array.isArray(grants.payload.items) ? grants.payload.items : [], config, input.environment);
	if (!acceptanceGrant && input.environment === 'local' && cleanupProvisionedProvider) {
		const grantId = `${input.prefix}-grant`;
		const created = await adminClient.createCapacityGrant(config.teamId, {
			schemaVersion: 2,
			id: grantId,
			membershipId: config.membershipId,
			providerId: config.providerId,
			projectId: config.projectId,
			environment: input.environment,
			status: 'planned',
			executionProviderIds: ['acceptance-deterministic'],
			laneIds: [],
			capabilities: ['planning', 'agent_mode_run', 'repo_read', 'usage_report'],
			allowedModes: ['planning'],
			dailyCreditLimit: 10,
			monthlyCreditLimit: 10,
			maxConcurrentAssignments: 1,
			metadata,
		}, `capacity-acceptance:${input.runId}:grant-create`);
		await adminClient.transitionCapacityGrant(config.teamId, grantId, 'activate', `capacity-acceptance:${input.runId}:grant-activate`);
		acceptanceGrant = created.payload;
		grantIdForCleanup = grantId;
	}
	if (!acceptanceGrant) {
		throw new Error(`Capacity acceptance did not find an active checked-in grant for project ${config.projectId} and provider ${config.providerId}.`);
	}
	const allocations = await adminClient.capacityAllocationSets(config.teamId, { limit: 200 });
	let activeAllocation = effectiveActiveAllocation(Array.isArray(allocations.payload.items) ? allocations.payload.items : []);
	if (!activeAllocation?.id && input.environment === 'local' && cleanupProvisionedProvider) {
		const allocationId = `${input.prefix}-allocation`;
		const created = await adminClient.createCapacityAllocationSet(config.teamId, {
			id: allocationId,
			effectiveFrom: new Date(Date.now() - 1_000).toISOString(),
			effectiveUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
			reservePolicy: { percent: 0, overflow: 'deny' },
			slices: [{
				id: `${allocationId}:project`,
				scope: 'project',
				targetId: config.projectId,
				policy: { minPercent: 0, targetPercent: 100, maxPercent: 100, hardCapPercent: 100 },
			}],
			borrowingRules: [],
			metadata,
		}, `capacity-acceptance:${input.runId}:allocation-create`);
		activeAllocation = (await adminClient.activateCapacityAllocationSet(
			config.teamId,
			String(created.payload.id),
			`capacity-acceptance:${input.runId}:allocation-activate`,
		)).payload;
	}
	if (!activeAllocation?.id) throw new Error('Capacity acceptance requires an active team allocation set.');
	humanPolicyFingerprint = await capacityAcceptancePolicyFingerprint({
		adminClient,
		teamId: config.teamId,
		grantId: String(acceptanceGrant.id),
		allocationId: String(activeAllocation.id),
	});
	availabilitySession = await providerClient.refreshAvailabilitySession(String(availabilitySession.payload.id), {
		expectedSequence: availabilitySession.payload.sequence,
		environment: input.environment,
		status: 'open',
		capabilities: ['repo_read', 'agent_mode_run', 'usage_report'],
		grants: [{
			grantId: String(acceptanceGrant.id),
			projectId: config.projectId,
			teamId: config.teamId,
			grantScope: typeof acceptanceGrant.grantScope === 'string' ? acceptanceGrant.grantScope : 'project',
		}],
		nativeLimits: { availableCredits: 30, maxConcurrentRunners: 1, wallMinutes: { session: 30 } },
		runnerPressure: { activeRunners: 0, maxConcurrentRunners: 1 },
		constraints: { liveAcceptance: true, outboundOnly: true },
		metadata,
		executionProviders: [{
			id: 'acceptance-deterministic', adapter: 'deterministic_workflow', status: 'available',
			capabilities: ['planning', 'agent_mode_run', 'repo_read', 'usage_report'],
			maxConcurrentRunners: 1, activeRunners: 0, nativeLimits: { availableCredits: 30 }, lanes: [],
		}],
	});
	const sessionId = String(availabilitySession.payload.id ?? '');
	if (!sessionId) throw new Error('Capacity acceptance availability session did not return a session id.');
	if (input.capacityAssignmentExecutor && provisionedRuntime) {
		const workdayRunId = `${input.prefix}-run`;
		await adminClient.createWorkdayRun(config.teamId, {
			id: workdayRunId,
			capacityProviderId: config.providerId,
			environment: input.environment,
			status: 'running',
			parameters: {
				projects: [config.projectSlug || config.projectId],
				durationSeconds: 180,
				allocationSetId: activeAllocation.id,
				availableCredits: 10,
				metadata,
			},
		});
		workdayRunIdForCleanup = workdayRunId;
		await adminClient.tickWorkdayRun(config.teamId, workdayRunId, {
			idempotencyKey: `capacity-acceptance:${input.runId}:tick`,
		});
		const competition = governanceAcceptance
			? await provisionLocalCapacityCompetition({
				adminClient,
				apiUrl: config.apiUrl,
				runId: input.runId,
				runtime: governanceAcceptance.runtime,
				fetchImpl: input.fetchImpl,
			})
			: null;
		if (competition) governanceAcceptance?.retainAuditTeam();
		cleanupCapacityCompetition = competition?.cleanup ?? null;
		const execution = await input.capacityAssignmentExecutor({
			runId: input.runId,
			apiUrl: config.apiUrl,
			teamId: config.teamId,
			projectId: config.projectId,
			providerId: config.providerId,
			membershipId: config.membershipId,
			credentialId: provisionedRuntime.credentialId,
			membershipCredential: provisionedRuntime.membershipCredential,
			providerAccessToken: provisionedRuntime.providerAccessToken,
			providerSessionId: sessionId,
			providerSessionSequence: Number(availabilitySession.payload.sequence),
			privateJwk: provisionedRuntime.privateJwk,
			assignmentId: null,
			executionProviderId: 'acceptance-deterministic',
			...(competition ? { competingConnection: competition.connection } : {}),
		}).catch((error) => {
			throw new Error(`Capacity acceptance Agent runtime executor failed: ${error instanceof Error ? error.message : String(error)}`);
		});
		const executedAssignmentId = execution.assignmentId;
		if (!executedAssignmentId) throw new Error('Capacity acceptance Agent runtime executor did not identify its durable assignment.');
		if (competition && governanceAcceptance) {
			if (!execution.finalSlot) throw new Error('Capacity acceptance Agent runtime omitted provider-global final-slot evidence.');
			const deferred = await adminClient.capacityProviderAssignment(
				competition.connection.teamId,
				competition.connection.assignmentId,
			);
			const deferredAssignmentRemainedPending = deferred.payload.status === 'pending';
			if (!deferredAssignmentRemainedPending) {
				throw new Error(`Competing second-team assignment left pending state under the exhausted provider-global slot: ${String(deferred.payload.status)}.`);
			}
			await competition.cleanup();
			cleanupCapacityCompetition = null;
			starterProofs = await runLocalAutonomousStarterAcceptances({
				adminClient, apiUrl: config.apiUrl, runId: input.runId,
				runtime: governanceAcceptance.runtime, fetchImpl: input.fetchImpl,
				privateJwk: provisionedRuntime.privateJwk, executor: input.capacityAssignmentExecutor,
			});
			governanceProof = await governanceAcceptance.finalize({
				...execution.finalSlot,
				deferredAssignmentRemainedPending,
			});
		}
		const terminal = await verifyCapacityAcceptanceTerminal({ adminClient, config, assignmentId: executedAssignmentId });
		await assertCapacityAcceptancePolicyUnchanged({
			adminClient,
			teamId: config.teamId,
			grantId: String(acceptanceGrant.id),
			allocationId: String(activeAllocation.id),
			expectedFingerprint: humanPolicyFingerprint,
		});
		completedAssignmentId = executedAssignmentId;
		return {
			sessionId,
			assignmentId: executedAssignmentId,
			mode: mode,
			runnerId: 'provider-manager-dispatch',
			governance: governanceProof,
			...(starterProofs ?? {}),
			...terminal,
		};
	}
	const workDayId = `${input.prefix}-workday`;
	await adminClient.createWorkday({
		id: workDayId,
		projectId: config.projectId,
		allocationSetId: activeAllocation.id,
		environment: input.environment,
		status: 'active',
		availableCredits: 10,
		envelope: { totalCredits: 10, availableCredits: 10, metadata },
		metadata: { ...metadata, grantId: String(acceptanceGrant.id) },
	}, `live-acceptance:${input.runId}:workday:${workDayId}`);
	workdayIdForCleanup = workDayId;
	const admission = await adminClient.admitCapacityAssignment(config.teamId, {
		assignmentId,
		reservationId: `${input.prefix}-reservation`,
		projectId: config.projectId,
		providerId: config.providerId,
		membershipId: config.membershipId,
		environment: input.environment,
		providerSessionId: sessionId,
		projectAgentClassId: agentClassId,
		executionProviderId: 'acceptance-deterministic',
		workDayId,
		requestedCredits: 1,
		mode,
		capacityEnvelope: {
			teamId: config.teamId,
			projectId: config.projectId,
			providerId: config.providerId,
			workDayId,
			mode,
			limits: { wallMinutes: 5 },
			metadata,
		},
		decisionInput: {
			kind: 'capacity_acceptance_diagnostic',
			runId: input.runId,
			mode,
			instructions: 'Execute the isolated capacity acceptance diagnostic without widening project or provider scope.',
		},
		workspaceContext: {
			liveAcceptance: true,
			runId: input.runId,
		},
		metadata,
	}, `capacity-acceptance:${input.runId}:${assignmentId}`);
	const admittedAssignment = admission.payload?.assignment as Record<string, unknown> | undefined;
	if (!admittedAssignment?.id) throw new Error('Capacity acceptance admission did not create an assignment.');
	if (String(admittedAssignment.id) !== assignmentId) throw new Error(`Capacity acceptance admission created unexpected assignment ${String(admittedAssignment.id)}.`);
	let leased = null as Awaited<ReturnType<typeof providerClient.nextAssignment>> | null;
	for (let attempt = 0; attempt < 10; attempt += 1) {
		leased = await providerClient.nextAssignment({
			sessionId,
			runnerId,
			leaseSeconds: 120,
			metadata,
		});
		const leasedId = leased.payload?.id ? String(leased.payload.id) : '';
		if (!leasedId) throw new Error('Capacity acceptance did not lease an assignment.');
		if (leasedId === assignmentId) break;
		const leasedMetadata = leased.payload?.metadata && typeof leased.payload.metadata === 'object'
			? leased.payload.metadata as Record<string, unknown>
			: {};
		if (leasedMetadata.liveAcceptance !== true) {
			throw new Error(`Capacity acceptance leased ${leasedId} instead of diagnostic assignment ${assignmentId}.`);
		}
		const staleLeaseToken = leased.leaseToken ?? leased.payload.leaseToken ?? null;
		if (!staleLeaseToken) throw new Error(`Capacity acceptance leased stale diagnostic ${leasedId} without a lease token.`);
		await providerClient.settleAssignment(leasedId, { actualCredits: 0, metadata: { ...metadata, retiredStaleAcceptanceAssignment: true } }, `capacity-acceptance-stale-settlement:${leasedId}`);
		await providerClient.completeAssignment(leasedId, {
			runnerId,
			leaseToken: staleLeaseToken,
			output: { summary: 'Retired stale capacity acceptance diagnostic.', runId: input.runId },
			summary: { runId: input.runId, retiredAssignmentId: leasedId },
			metadata: {
				...metadata,
				retiredStaleAcceptanceAssignment: true,
				retiredAssignmentId: leasedId,
			},
		});
		leased = null;
	}
	if (!leased?.payload?.id) throw new Error('Capacity acceptance did not lease an assignment.');
	if (leased.payload.id !== assignmentId) {
		throw new Error(`Capacity acceptance leased stale diagnostics but did not reach diagnostic assignment ${assignmentId}.`);
	}
	const leaseToken = leased.leaseToken ?? leased.payload.leaseToken ?? null;
	if (!leaseToken) throw new Error('Capacity acceptance lease did not include a lease token.');
	await createTreeDxProxyAuditEvidence({
		fetchImpl: input.fetchImpl,
		apiUrl: config.apiUrl,
		providerAccessToken: config.providerAccessToken,
		projectId: config.projectId,
		assignmentId,
		runId: input.runId,
	});
	const modeRun = await providerClient.createAssignmentModeRun(assignmentId, {
		status: 'succeeded',
		selectedInput: { kind: 'capacity_acceptance_diagnostic', runId: input.runId, mode },
		outputs: { summary: 'Capacity acceptance diagnostic completed.', runId: input.runId },
		usageActual: {
			actualCredits: 0,
			nativeUsage: { nativeUnit: 'request', amount: 1, source: 'capacity_acceptance' },
			metadata,
		},
		traceRefs: { liveAcceptanceRunId: input.runId },
		metadata,
	});
	const modeRunId = String(modeRun.payload.id ?? '');
	if (!modeRunId) throw new Error('Capacity acceptance mode-run creation did not return an id.');
	await providerClient.settleAssignment(assignmentId, {
		modeRunId,
		actualCredits: 0.25,
		providerUnits: 1,
		metadata,
	}, `capacity-acceptance-settlement:${input.runId}:${assignmentId}`);
	const completed = await providerClient.completeAssignment(assignmentId, {
		runnerId,
		leaseToken,
		modeRunId,
		output: { summary: 'Capacity acceptance diagnostic completed.', runId: input.runId },
		summary: { runId: input.runId, modeRunId },
		metadata,
	});
	const finalStatus = String(completed.payload?.status ?? '');
	if (finalStatus !== 'completed') {
		throw new Error(`Capacity acceptance assignment finished with status "${finalStatus || 'unknown'}".`);
	}
	await assertCapacityAcceptancePolicyUnchanged({
		adminClient,
		teamId: config.teamId,
		grantId: String(acceptanceGrant.id),
		allocationId: String(activeAllocation.id),
		expectedFingerprint: humanPolicyFingerprint,
	});
	completedAssignmentId = assignmentId;
	const modeRuns = await adminClient.projectAgentModeRuns(config.projectId, { assignmentId });
	const modeRunCount = modeRuns.payload.items.length;
	if (!modeRunCount) throw new Error('Capacity acceptance mode-run was not visible through project mode-run inspection.');
	return {
		sessionId,
		assignmentId,
		modeRunId,
		finalStatus,
		mode,
		runnerId,
		modeRunCount,
		artifactCount: 0,
		toolEventCount: 0,
		usageActualCount: 0,
		ledgerEntryCount: 0,
		governance: governanceProof,
	};
	} finally {
		const cleanupErrors: string[] = [];
		const cleanup = async (label: string, operation: () => Promise<unknown>) => {
			try { await operation(); }
			catch (error) { cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
		};
		if (workdayRunIdForCleanup) await cleanup('complete workday run', () => adminClient.updateWorkdayRun(config.teamId, workdayRunIdForCleanup, { status: 'completed' }));
		if (workdayIdForCleanup) await cleanup('complete workday', () => adminClient.completeWorkday(workdayIdForCleanup, `capacity-acceptance:${input.runId}:workday-complete`));
		if (sessionIdForCleanup) await cleanup('close availability session', () => closeCapacityAcceptanceAvailabilitySession({
			apiUrl: config.apiUrl,
			runId: input.runId,
			sessionId: sessionIdForCleanup,
			fetchImpl: input.fetchImpl,
			providerClient,
			provisionedRuntime,
		}));
		if (grantIdForCleanup) await cleanup('revoke capacity grant', () => adminClient.transitionCapacityGrant(config.teamId, grantIdForCleanup, 'revoke', `capacity-acceptance:${input.runId}:grant-revoke`));
		if (cleanupCapacityCompetition) await cleanup('delete capacity competition resources', cleanupCapacityCompetition);
		if (cleanupProvisionedProvider) await cleanup('revoke provider membership', cleanupProvisionedProvider);
		if (cleanupGovernanceProof) await cleanup('delete governance acceptance team', cleanupGovernanceProof);
		if (cleanupProvisionedProvider && completedAssignmentId) {
			await cleanup('verify revoked provider access', () => assertRevokedCapacityProviderAccess({ providerClient, assignmentId: completedAssignmentId }));
		}
		if (!cleanupErrors.length && cleanupProvisionedProvider) {
			await cleanup('verify terminal cleanup', () => verifyCapacityAcceptanceCleanup({
				adminClient, teamId: config.teamId, membershipId: config.membershipId, providerId: config.providerId,
				grantId: grantIdForCleanup, workdayId: workdayIdForCleanup,
				workdayRunId: workdayRunIdForCleanup, sessionId: sessionIdForCleanup,
			}));
		}
		if (cleanupErrors.length) throw new Error(`Capacity acceptance cleanup failed: ${cleanupErrors.join('; ')}`);
	}
}
