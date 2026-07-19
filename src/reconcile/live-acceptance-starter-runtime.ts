import { MarketClient } from '../market-client.ts';
import {
	capacityProviderPublicIdentity,
	ProviderProtocolClient,
	signCapacityProviderProof,
	type CapacityProviderPrivateJwk,
} from '../capacity-provider.ts';
import type { CapacityGovernanceRuntimeConnection } from './live-acceptance-capacity-governance.ts';
import { bindLocalCapacityTreeDxRepository, syncLocalAcceptanceAgentClasses } from './live-acceptance-capacity-context.ts';

export interface LocalStarterCapacityConfig {
	starter: 'engineering' | 'research';
	repositoryName: string;
	agentPaths: string[];
	capabilities: string[];
	allowedModes: Array<'planning' | 'acting'>;
	credits: number;
	durationSeconds?: number;
	parameters: Record<string, unknown> | ((input: { projectId: string; projectSlug: string; allocationSetId: string; repositoryRef: string }) => Record<string, unknown>);
	projectMetadata: Record<string, unknown>;
}

function projectRecord(payload: Record<string, unknown>) {
	const nested = payload.project && typeof payload.project === 'object' && !Array.isArray(payload.project)
		? payload.project as Record<string, unknown>
		: payload;
	const id = String(nested.id ?? '');
	const slug = String(nested.slug ?? id);
	if (!id) throw new Error('Starter acceptance project creation omitted its id.');
	return { id, slug };
}

async function waitForProjectDeletion(adminClient: MarketClient, teamId: string, projectId: string) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const projects = await adminClient.projects(teamId);
		if (!(projects.payload as Array<Record<string, unknown>>).some((entry) => entry.id === projectId)) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error(`Starter acceptance project ${projectId} did not reach deleted state.`);
}

export async function provisionLocalStarterCapacity(input: {
	adminClient: MarketClient;
	apiUrl: string;
	runId: string;
	runtime: CapacityGovernanceRuntimeConnection;
	privateJwk: CapacityProviderPrivateJwk;
	fetchImpl: typeof fetch;
	config: LocalStarterCapacityConfig;
}) {
	const key = `${input.config.starter}-starter:${input.runId}`;
	const slug = `${input.config.starter}-${input.runId.replace(/[^a-z0-9]/giu, '').toLowerCase().slice(-20)}`;
	const created = await input.adminClient.createProject(input.runtime.teamId, {
		slug, name: `${input.config.starter} starter acceptance ${input.runId}`,
		description: `Isolated live acceptance project bound to the reconciled ${input.config.starter} starter.`,
		metadata: { liveAcceptance: true, runId: input.runId, ...input.config.projectMetadata },
	});
	const project = projectRecord(created.payload);
	const protocol = new ProviderProtocolClient({ marketUrl: input.apiUrl, accessToken: input.runtime.providerAccessToken, fetchImpl: input.fetchImpl });
	const grantId = `${key}:grant`;
	const allocationId = `${key}:allocation`;
	const workdayRunId = `${key}:run`;
	const durationSeconds = input.config.durationSeconds ?? 1_200;
	if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
		throw new Error('Starter acceptance duration must be a positive whole number of seconds.');
	}
	let sessionId = '';
	let sessionCreated = false;
	let grantCreated = false;
	let runCreated = false;
	const cleanup = async () => {
		const errors: string[] = [];
		const run = async (label: string, operation: () => Promise<unknown>) => {
			try { await operation(); } catch (error) { errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
		};
		if (runCreated) await run('complete workday run', () => input.adminClient.updateWorkdayRun(input.runtime.teamId, workdayRunId, { status: 'completed', summary: { liveAcceptance: true } }));
		if (sessionCreated) await run('close availability session', async () => {
			const accessKey = `${key}:cleanup-access:${Date.now()}`;
			const accessProof = await signCapacityProviderProof({
				privateJwk: input.privateJwk,
				publicJwk: capacityProviderPublicIdentity(input.privateJwk),
				method: 'POST', path: '/v1/provider/access-tokens', audience: input.apiUrl,
				body: { credentialId: input.runtime.credentialId, idempotencyKey: accessKey },
			});
			const access = await protocol.issueAccessToken(
				input.runtime.membershipCredential, input.runtime.credentialId, accessProof, accessKey,
			);
			await new ProviderProtocolClient({
				marketUrl: input.apiUrl, accessToken: access.accessToken, fetchImpl: input.fetchImpl,
			}).closeAvailabilitySession(sessionId);
		});
		if (grantCreated) await run('revoke grant', () => input.adminClient.transitionCapacityGrant(input.runtime.teamId, grantId, 'revoke', `${key}:grant-revoke`));
		await run('delete project', async () => {
			await input.adminClient.deleteProject(project.id, `DELETE ${project.slug}`);
			await waitForProjectDeletion(input.adminClient, input.runtime.teamId, project.id);
		});
		if (errors.length) throw new Error(`Starter acceptance cleanup failed: ${errors.join('; ')}`);
	};
	try {
		const binding = await bindLocalCapacityTreeDxRepository(input.adminClient, {
			projectId: project.id, projectSlug: project.slug, teamId: input.runtime.teamId,
		}, { repositoryName: input.config.repositoryName, contentPath: 'template/src/content' });
		const synchronized = await syncLocalAcceptanceAgentClasses(input.adminClient, {
			projectId: project.id, repositoryId: String(binding.repositoryId), agentPaths: input.config.agentPaths, runId: input.runId,
		});
		const executionProvider = {
			id: 'acceptance-deterministic', adapter: 'deterministic_workflow', status: 'available',
			capabilities: input.config.capabilities, maxConcurrentRunners: 1, activeRunners: 0,
			nativeLimits: { availableCredits: input.config.credits }, lanes: [],
		};
		let availability = await protocol.createAvailabilitySession({
			environment: 'local', status: 'open', capabilities: input.config.capabilities, grants: [],
			nativeLimits: { availableCredits: input.config.credits, maxConcurrentRunners: 1 },
			runnerPressure: { activeRunners: 0, maxConcurrentRunners: 1 },
			metadata: { liveAcceptance: true, runId: input.runId, starter: input.config.starter }, executionProviders: [executionProvider],
		});
		sessionId = String(availability.payload.id ?? '');
		if (!sessionId) throw new Error('Starter availability session omitted its id.');
		sessionCreated = true;
		await input.adminClient.createCapacityGrant(input.runtime.teamId, {
			schemaVersion: 2, id: grantId, membershipId: input.runtime.membershipId, providerId: input.runtime.providerId,
			projectId: project.id, environment: 'local', status: 'planned', executionProviderIds: ['acceptance-deterministic'], laneIds: [],
			capabilities: input.config.capabilities, allowedModes: input.config.allowedModes,
			dailyCreditLimit: input.config.credits, monthlyCreditLimit: input.config.credits, maxConcurrentAssignments: 1,
			metadata: { liveAcceptance: true, runId: input.runId, starter: input.config.starter },
		}, `${key}:grant-create`);
		grantCreated = true;
		await input.adminClient.transitionCapacityGrant(input.runtime.teamId, grantId, 'activate', `${key}:grant-activate`);
		const allocation = await input.adminClient.createCapacityAllocationSet(input.runtime.teamId, {
			id: allocationId,
			effectiveFrom: new Date(Date.now() - 1_000).toISOString(),
			effectiveUntil: new Date(Date.now() + (durationSeconds + 300) * 1_000).toISOString(),
			reservePolicy: { percent: 0, overflow: 'deny' },
			slices: [{ id: `${allocationId}:project`, scope: 'project', targetId: project.id, policy: { minPercent: 0, targetPercent: 100, maxPercent: 100, hardCapPercent: 100 } }],
			borrowingRules: [], metadata: { liveAcceptance: true, runId: input.runId, starter: input.config.starter },
		}, `${key}:allocation-create`);
		const active = (await input.adminClient.capacityAllocationSets(input.runtime.teamId, { limit: 200 })).payload.items
			.find((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).status === 'active') as Record<string, unknown> | undefined;
		await input.adminClient.supersedeCapacityAllocationSet(input.runtime.teamId, String(allocation.payload.id), { expectedActiveAllocationSetId: active?.id ?? null }, `${key}:allocation-supersede`);
		availability = await protocol.refreshAvailabilitySession(sessionId, {
			expectedSequence: availability.payload.sequence, environment: 'local', status: 'open', capabilities: input.config.capabilities,
			grants: [{ grantId, projectId: project.id, teamId: input.runtime.teamId, grantScope: 'project' }],
			nativeLimits: { availableCredits: input.config.credits, maxConcurrentRunners: 1 }, runnerPressure: { activeRunners: 0, maxConcurrentRunners: 1 },
			metadata: { liveAcceptance: true, runId: input.runId, starter: input.config.starter }, executionProviders: [executionProvider],
		});
		const configuredParameters = typeof input.config.parameters === 'function'
			? input.config.parameters({ projectId: project.id, projectSlug: project.slug, allocationSetId: String(allocation.payload.id), repositoryRef: synchronized.resolvedRef })
			: input.config.parameters;
		await input.adminClient.createWorkdayRun(input.runtime.teamId, {
			id: workdayRunId, capacityProviderId: input.runtime.providerId, environment: 'local', status: 'running',
			parameters: { projects: [project.slug], durationSeconds, allocationSetId: allocation.payload.id, availableCredits: input.config.credits, ...configuredParameters },
		});
		runCreated = true;
		return {
			key, project, binding, grantId, allocationId: String(allocation.payload.id), workdayRunId,
			connection: { ...input.runtime, projectId: project.id, providerSessionId: sessionId, providerSessionSequence: Number(availability.payload.sequence) },
			cleanup,
		};
	} catch (error) {
		await cleanup().catch((cleanupError) => { throw new AggregateError([error, cleanupError], 'Starter provisioning and cleanup both failed.'); });
		throw error;
	}
}
