import { ProviderProtocolClient } from '../../../capacity/providers/capacity-provider.ts';
import { MarketClient } from '../../../entrypoints/clients/market-client.ts';
import type { CapacityGovernanceRuntimeConnection } from './live-acceptance-capacity-governance.ts';

export interface CapacityCompetitionRuntimeConnection extends CapacityGovernanceRuntimeConnection {
	projectId: string;
	providerSessionId: string;
	providerSessionSequence: number;
	assignmentId: string;
}

function projectRecord(payload: { project?: { id: string; slug: string; teamId: string }; id?: string; slug?: string; teamId?: string }) {
	const project = payload.project ?? payload;
	if (!project.id) throw new Error('Capacity competition project creation omitted its project id.');
	return { id: project.id, slug: project.slug ?? project.id };
}

async function waitForProjectDeletion(adminClient: MarketClient, teamId: string, projectId: string) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const projects = await adminClient.projects(teamId);
		if (!(projects.payload as Array<Record<string, unknown>>).some((entry) => entry.id === projectId)) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error(`Capacity competition project ${projectId} did not reach deleted state.`);
}

export async function provisionLocalCapacityCompetition(input: {
	adminClient: MarketClient;
	apiUrl: string;
	runId: string;
	runtime: CapacityGovernanceRuntimeConnection;
	fetchImpl: typeof fetch;
}) {
	const prefix = `capacity-competition:${input.runId}`;
	const projectSlug = `cap-${input.runId.replace(/[^a-z0-9]/giu, '').toLowerCase().slice(-20)}-work`.slice(0, 39).replace(/-+$/u, '');
	const createdProject = await input.adminClient.createProject(input.runtime.teamId, {
		slug: projectSlug,
		name: `Capacity competition ${input.runId}`,
		description: 'Isolated two-team provider-global final-slot acceptance project.',
		metadata: { liveAcceptance: true, runId: input.runId, purpose: 'provider-global-final-slot' },
	});
	const project = projectRecord(createdProject.payload);
	const providerClient = new ProviderProtocolClient({
		marketUrl: input.apiUrl,
		accessToken: input.runtime.providerAccessToken,
		fetchImpl: input.fetchImpl,
		userAgent: `treeseed-capacity-competition/${input.runId}`,
	});
	let sessionId = '';
	const agentClassId = `competition-testing-${input.runId}`;
	const grantId = `competition-${input.runId}-grant`;
	const allocationId = `competition-${input.runId}-allocation`;
	const workdayId = `competition-${input.runId}-workday`;
	const assignmentId = `competition-${input.runId}-assignment`;
	let sessionCreated = false;
	let grantCreated = false;
	let workdayCreated = false;
	let assignmentCreated = false;
	const cleanup = async () => {
		const errors: string[] = [];
		const run = async (label: string, operation: () => Promise<unknown>) => {
			try { await operation(); }
			catch (error) { errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
		};
		if (assignmentCreated) await run('cancel competing assignment', () => input.adminClient.cancelCapacityAssignment(input.runtime.teamId, assignmentId, { idempotencyKey: `${prefix}:assignment-cancel`, reason: 'final-slot acceptance completed' }));
		if (workdayCreated) await run('complete competing workday', () => input.adminClient.completeWorkday(workdayId, `${prefix}:workday-complete`));
		if (sessionCreated) await run('close competing availability', () => providerClient.closeAvailabilitySession(sessionId));
		if (grantCreated) await run('revoke competing grant', () => input.adminClient.transitionCapacityGrant(input.runtime.teamId, grantId, 'revoke', `${prefix}:grant-revoke`));
		await run('delete competing project', async () => {
			await input.adminClient.deleteProject(project.id, `DELETE ${project.slug}`);
			await waitForProjectDeletion(input.adminClient, input.runtime.teamId, project.id);
		});
		if (errors.length) throw new Error(`Capacity competition cleanup failed: ${errors.join('; ')}`);
	};
	try {
		let availability = await providerClient.createAvailabilitySession({
			environment: 'local',
			status: 'open',
			capabilities: ['planning', 'repo_read', 'agent_mode_run', 'usage_report'],
			grants: [],
			nativeLimits: { availableCredits: 10, maxConcurrentRunners: 1 },
			runnerPressure: { activeRunners: 0, maxConcurrentRunners: 1 },
			metadata: { liveAcceptance: true, runId: input.runId },
			executionProviders: [{
				id: 'codex', adapter: 'codex', status: 'available',
				capabilities: ['planning', 'repo_read', 'agent_mode_run', 'usage_report'],
				maxConcurrentRunners: 1, activeRunners: 0, nativeLimits: { availableCredits: 10 }, lanes: [],
			}],
		});
		sessionId = String(availability.payload.id ?? '');
		if (!sessionId) throw new Error('Capacity competition availability session omitted its id.');
		sessionCreated = true;
		await input.adminClient.createProjectAgentClass(project.id, {
			id: agentClassId, slug: agentClassId, name: 'Competition testing agents', status: 'active',
			allowedModes: ['planning'], requiredCapabilities: ['agent_mode_run'],
			metadata: { liveAcceptance: true, runId: input.runId },
		}, `${prefix}:agent-class`);
		await input.adminClient.createCapacityGrant(input.runtime.teamId, {
			schemaVersion: 2, id: grantId, membershipId: input.runtime.membershipId, providerId: input.runtime.providerId,
			projectId: project.id, environment: 'local', status: 'planned', executionProviderIds: ['codex'], laneIds: [],
			capabilities: ['planning', 'repo_read', 'agent_mode_run', 'usage_report'], allowedModes: ['planning'],
			dailyCreditLimit: 10, monthlyCreditLimit: 10, maxConcurrentAssignments: 1,
			metadata: { liveAcceptance: true, runId: input.runId },
		}, `${prefix}:grant-create`);
		grantCreated = true;
		await input.adminClient.transitionCapacityGrant(input.runtime.teamId, grantId, 'activate', `${prefix}:grant-activate`);
		const allocation = await input.adminClient.createCapacityAllocationSet(input.runtime.teamId, {
			id: allocationId,
			effectiveFrom: new Date(Date.now() - 1_000).toISOString(),
			effectiveUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
			reservePolicy: { percent: 0, overflow: 'deny' },
			slices: [{ id: `${allocationId}:project`, scope: 'project', targetId: project.id, policy: { minPercent: 0, targetPercent: 100, maxPercent: 100, hardCapPercent: 100 } }],
			borrowingRules: [], metadata: { liveAcceptance: true, runId: input.runId },
		}, `${prefix}:allocation-create`);
		const activeAllocation = await input.adminClient.activateCapacityAllocationSet(input.runtime.teamId, String(allocation.payload.id), `${prefix}:allocation-activate`);
		availability = await providerClient.refreshAvailabilitySession(sessionId, {
			expectedSequence: availability.payload.sequence,
			environment: 'local', status: 'open', capabilities: ['planning', 'repo_read', 'agent_mode_run', 'usage_report'],
			grants: [{ grantId, projectId: project.id, teamId: input.runtime.teamId, grantScope: 'project' }],
			nativeLimits: { availableCredits: 10, maxConcurrentRunners: 1 },
			runnerPressure: { activeRunners: 0, maxConcurrentRunners: 1 },
			metadata: { liveAcceptance: true, runId: input.runId },
			executionProviders: [{
				id: 'codex', adapter: 'codex', status: 'available',
				capabilities: ['planning', 'repo_read', 'agent_mode_run', 'usage_report'],
				maxConcurrentRunners: 1, activeRunners: 0, nativeLimits: { availableCredits: 10 }, lanes: [],
			}],
		});
		await input.adminClient.createWorkday({
			id: workdayId, projectId: project.id, allocationSetId: activeAllocation.payload.id, environment: 'local', status: 'active', availableCredits: 10,
			envelope: { totalCredits: 10, availableCredits: 10, metadata: { liveAcceptance: true, runId: input.runId } },
			metadata: { liveAcceptance: true, runId: input.runId, grantId },
		}, `${prefix}:workday-create`);
		workdayCreated = true;
		await input.adminClient.admitCapacityAssignment(input.runtime.teamId, {
			assignmentId, reservationId: `${assignmentId}-reservation`, projectId: project.id, providerId: input.runtime.providerId,
			membershipId: input.runtime.membershipId, environment: 'local', providerSessionId: sessionId,
			projectAgentClassId: agentClassId, executionProviderId: 'codex', workDayId: workdayId,
			requestedCredits: 1, mode: 'planning',
			capacityEnvelope: { teamId: input.runtime.teamId, projectId: project.id, providerId: input.runtime.providerId, workDayId: workdayId, mode: 'planning', limits: { wallMinutes: 5 }, metadata: { liveAcceptance: true, runId: input.runId } },
			decisionInput: { kind: 'provider_global_final_slot_competition', runId: input.runId },
			workspaceContext: { liveAcceptance: true, runId: input.runId },
			metadata: { liveAcceptance: true, runId: input.runId, priority: 1_000_000 },
		}, `${prefix}:assignment-admit`);
		assignmentCreated = true;
		return {
			connection: {
				...input.runtime,
				projectId: project.id,
				providerSessionId: sessionId,
				providerSessionSequence: Number(availability.payload.sequence),
				assignmentId,
			} satisfies CapacityCompetitionRuntimeConnection,
			cleanup,
		};
	} catch (error) {
		await cleanup().catch((cleanupError) => {
			throw new AggregateError([error, cleanupError], 'Capacity competition provisioning and cleanup both failed.');
		});
		throw error;
	}
}
