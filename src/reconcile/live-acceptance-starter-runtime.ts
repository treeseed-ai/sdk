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

const LIVE_PROVIDER_ASSIGNMENT_BUDGET_SECONDS = 600;
const TERMINAL_WORKDAY_RUN_STATUSES = new Set(['completed', 'cancelled', 'failed', 'degraded']);

export function localStarterDurationSeconds(config: Pick<LocalStarterCapacityConfig, 'credits' | 'durationSeconds'>) {
	const durationSeconds = config.durationSeconds
		?? config.credits * LIVE_PROVIDER_ASSIGNMENT_BUDGET_SECONDS;
	if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
		throw new Error('Starter acceptance duration must be a positive whole number of seconds.');
	}
	return durationSeconds;
}

export function localStarterProjectSlug(starter: LocalStarterCapacityConfig['starter'], runId: string) {
	return `${starter}-${runId.replace(/[^a-z0-9]/giu, '').toLowerCase().slice(-20)}`;
}

export async function finalizeLocalStarterAcceptance(
	cleanup: (status: 'completed' | 'cancelled') => Promise<unknown>,
	executionError: unknown,
	label: string,
) {
	try {
		await cleanup(executionError ? 'cancelled' : 'completed');
	} catch (cleanupError) {
		if (executionError) throw new AggregateError([executionError, cleanupError], `${label} execution and cleanup both failed.`);
		throw cleanupError;
	}
}

export async function terminalizeStarterWorkdayRun(input: {
	adminClient: MarketClient;
	teamId: string;
	workdayRunId: string;
	status: 'completed' | 'cancelled';
	summary: Record<string, unknown>;
}) {
	const observed = await input.adminClient.workdayRun(input.teamId, input.workdayRunId);
	const status = String(observed.payload.run.status ?? '');
	if (TERMINAL_WORKDAY_RUN_STATUSES.has(status)) return observed.payload.run;
	return (await input.adminClient.updateWorkdayRun(input.teamId, input.workdayRunId, {
		status: input.status,
		summary: input.summary,
	})).payload;
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

export async function provisionLocalStarterProject(input: {
	adminClient: MarketClient;
	runId: string;
	runtime: CapacityGovernanceRuntimeConnection;
	config: LocalStarterCapacityConfig;
}) {
	const slug = localStarterProjectSlug(input.config.starter, input.runId);
	const created = await input.adminClient.createProject(input.runtime.teamId, {
		slug, name: `${input.config.starter} starter acceptance ${input.runId}`,
		description: `Isolated live acceptance project bound to the reconciled ${input.config.starter} starter.`,
		metadata: { liveAcceptance: true, runId: input.runId, ...input.config.projectMetadata },
	});
	const project = projectRecord(created.payload);
	const cleanup = async () => {
		await input.adminClient.deleteProject(project.id, `DELETE ${project.slug}`);
		await waitForProjectDeletion(input.adminClient, input.runtime.teamId, project.id);
	};
	try {
		const binding = await bindLocalCapacityTreeDxRepository(input.adminClient, {
			projectId: project.id, projectSlug: project.slug, teamId: input.runtime.teamId,
		}, { repositoryName: input.config.repositoryName, contentPath: 'template/src/content' });
		const synchronized = await syncLocalAcceptanceAgentClasses(input.adminClient, {
			projectId: project.id, repositoryId: String(binding.repositoryId), agentPaths: input.config.agentPaths, runId: input.runId,
		});
		return { project, binding, synchronized, cleanup };
	} catch (error) {
		await cleanup().catch((cleanupError) => { throw new AggregateError([error, cleanupError], 'Starter project provisioning and cleanup both failed.'); });
		throw error;
	}
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
	const provisionedProject = await provisionLocalStarterProject(input);
	const project = provisionedProject.project;
	const bootstrapProtocol = new ProviderProtocolClient({ marketUrl: input.apiUrl, fetchImpl: input.fetchImpl });
	let protocol = bootstrapProtocol;
	let starterAccessToken = '';
	const grantId = `${key}:grant`;
	const allocationId = `${key}:allocation`;
	const workdayRunId = `${key}:run`;
	const durationSeconds = localStarterDurationSeconds(input.config);
	let sessionId = '';
	let sessionCreated = false;
	let grantCreated = false;
	let runCreated = false;
	const cleanup = async (runStatus: 'completed' | 'cancelled' = 'completed') => {
		const errors: string[] = [];
		const run = async (label: string, operation: () => Promise<unknown>) => {
			try { await operation(); } catch (error) { errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
		};
		if (runCreated) await run(`${runStatus} workday run`, () => terminalizeStarterWorkdayRun({
			adminClient: input.adminClient, teamId: input.runtime.teamId, workdayRunId, status: runStatus,
			summary: { liveAcceptance: true, cleanupStatus: runStatus },
		}));
		if (sessionCreated) await run('close availability session', async () => {
			const accessKey = `${key}:cleanup-access:${Date.now()}`;
			const accessProof = await signCapacityProviderProof({
				privateJwk: input.privateJwk,
				publicJwk: capacityProviderPublicIdentity(input.privateJwk),
				method: 'POST', path: '/v1/provider/access-tokens', audience: input.apiUrl,
				body: { credentialId: input.runtime.credentialId, idempotencyKey: accessKey },
			});
			const access = await bootstrapProtocol.issueAccessToken(
				input.runtime.membershipCredential, input.runtime.credentialId, accessProof, accessKey,
			);
			await new ProviderProtocolClient({
				marketUrl: input.apiUrl, accessToken: access.accessToken, fetchImpl: input.fetchImpl,
			}).closeAvailabilitySession(sessionId);
		});
		if (grantCreated) await run('revoke grant', () => input.adminClient.transitionCapacityGrant(input.runtime.teamId, grantId, 'revoke', `${key}:grant-revoke`));
		await run('delete project', provisionedProject.cleanup);
		if (errors.length) throw new Error(`Starter acceptance cleanup failed: ${errors.join('; ')}`);
	};
	try {
		const accessKey = `${key}:access:${crypto.randomUUID()}`;
		const accessProof = await signCapacityProviderProof({
			privateJwk: input.privateJwk,
			publicJwk: capacityProviderPublicIdentity(input.privateJwk),
			method: 'POST', path: '/v1/provider/access-tokens', audience: input.apiUrl,
			body: { credentialId: input.runtime.credentialId, idempotencyKey: accessKey },
		});
		const access = await bootstrapProtocol.issueAccessToken(
			input.runtime.membershipCredential, input.runtime.credentialId, accessProof, accessKey,
		);
		starterAccessToken = access.accessToken;
		protocol = new ProviderProtocolClient({
			marketUrl: input.apiUrl,
			accessToken: starterAccessToken,
			fetchImpl: input.fetchImpl,
		});
		const { binding, synchronized } = provisionedProject;
		const executionProvider = {
			id: 'codex', adapter: 'codex', status: 'available',
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
			projectId: project.id, environment: 'local', status: 'planned', executionProviderIds: ['codex'], laneIds: [],
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
			connection: {
				...input.runtime,
				providerAccessToken: starterAccessToken,
				projectId: project.id,
				providerSessionId: sessionId,
				providerSessionSequence: Number(availability.payload.sequence),
			},
			cleanup,
		};
	} catch (error) {
		await cleanup('cancelled').catch((cleanupError) => { throw new AggregateError([error, cleanupError], 'Starter provisioning and cleanup both failed.'); });
		throw error;
	}
}

export async function provisionLocalStarterPortfolioCapacity(input: {
	adminClient: MarketClient;
	apiUrl: string;
	runId: string;
	runtime: CapacityGovernanceRuntimeConnection;
	privateJwk: CapacityProviderPrivateJwk;
	fetchImpl: typeof fetch;
	configs: LocalStarterCapacityConfig[];
}) {
	if (input.configs.length !== 2 || new Set(input.configs.map((config) => config.starter)).size !== 2) {
		throw new Error('Concurrent starter acceptance requires exactly one engineering and one research project.');
	}
	const key = `concurrent-starters:${input.runId}`;
	const provisions = await Promise.allSettled(input.configs.map((config) => provisionLocalStarterProject({
		...input,
		runId: `${input.runId}-portfolio`,
		config,
	})));
	const failed = provisions.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
	if (failed.length) {
		const cleanupResults = await Promise.allSettled(provisions
			.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof provisionLocalStarterProject>>> => result.status === 'fulfilled')
			.map((result) => result.value.cleanup()));
		const cleanupFailures = cleanupResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
		throw new AggregateError(
			[...failed.map((result) => result.reason), ...cleanupFailures.map((result) => result.reason)],
			'Concurrent starter project provisioning failed.',
		);
	}
	const projects = provisions.map((result) => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof provisionLocalStarterProject>>>).value);
	const bootstrapProtocol = new ProviderProtocolClient({ marketUrl: input.apiUrl, fetchImpl: input.fetchImpl });
	let protocol = bootstrapProtocol;
	const credits = input.configs.reduce((total, config) => total + config.credits, 0);
	const capabilities = [...new Set(input.configs.flatMap((config) => config.capabilities))];
	const grants: Array<{ grantId: string; projectId: string; teamId: string; grantScope: 'project' }> = [];
	const workdayRunIds: string[] = [];
	let sessionId = '';
	let sessionCreated = false;
	let availabilitySequence = 0;
	const cleanup = async (runStatus: 'completed' | 'cancelled' = 'completed') => {
		const errors: string[] = [];
		const run = async (label: string, operation: () => Promise<unknown>) => {
			try { await operation(); } catch (error) { errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
		};
		for (const workdayRunId of workdayRunIds) await run(`${runStatus} ${workdayRunId}`, () => terminalizeStarterWorkdayRun({
			adminClient: input.adminClient, teamId: input.runtime.teamId, workdayRunId, status: runStatus,
			summary: { liveAcceptance: true, concurrent: true, cleanupStatus: runStatus },
		}));
		if (sessionCreated) await run('close shared availability session', async () => {
			const accessKey = `${key}:cleanup-access:${Date.now()}`;
			const proof = await signCapacityProviderProof({
				privateJwk: input.privateJwk, publicJwk: capacityProviderPublicIdentity(input.privateJwk),
				method: 'POST', path: '/v1/provider/access-tokens', audience: input.apiUrl,
				body: { credentialId: input.runtime.credentialId, idempotencyKey: accessKey },
			});
			const access = await bootstrapProtocol.issueAccessToken(input.runtime.membershipCredential, input.runtime.credentialId, proof, accessKey);
			await new ProviderProtocolClient({ marketUrl: input.apiUrl, accessToken: access.accessToken, fetchImpl: input.fetchImpl }).closeAvailabilitySession(sessionId);
		});
		for (const grant of grants) await run(`revoke ${grant.grantId}`, () => input.adminClient.transitionCapacityGrant(input.runtime.teamId, grant.grantId, 'revoke', `${key}:revoke:${grant.projectId}`));
		for (const project of [...projects].reverse()) await run(`delete ${project.project.id}`, project.cleanup);
		if (errors.length) throw new Error(`Concurrent starter cleanup failed: ${errors.join('; ')}`);
	};
	try {
		const accessKey = `${key}:access:${crypto.randomUUID()}`;
		const proof = await signCapacityProviderProof({
			privateJwk: input.privateJwk, publicJwk: capacityProviderPublicIdentity(input.privateJwk),
			method: 'POST', path: '/v1/provider/access-tokens', audience: input.apiUrl,
			body: { credentialId: input.runtime.credentialId, idempotencyKey: accessKey },
		});
		const access = await bootstrapProtocol.issueAccessToken(input.runtime.membershipCredential, input.runtime.credentialId, proof, accessKey);
		protocol = new ProviderProtocolClient({ marketUrl: input.apiUrl, accessToken: access.accessToken, fetchImpl: input.fetchImpl });
		const executionProvider = {
			id: 'codex', adapter: 'codex', status: 'available', capabilities, maxConcurrentRunners: 2, activeRunners: 0,
			nativeLimits: { availableCredits: credits, maxConcurrentRunners: 2 }, lanes: [],
		};
		let availability = await protocol.createAvailabilitySession({
			environment: 'local', status: 'open', capabilities, grants: [],
			nativeLimits: { availableCredits: credits, maxConcurrentRunners: 2 },
			runnerPressure: { activeRunners: 0, maxConcurrentRunners: 2 },
			metadata: { liveAcceptance: true, runId: input.runId, concurrentStarters: true }, executionProviders: [executionProvider],
		});
		sessionId = String(availability.payload.id ?? '');
		if (!sessionId) throw new Error('Concurrent starter availability session omitted its id.');
		sessionCreated = true;
		for (let index = 0; index < projects.length; index += 1) {
			const project = projects[index]!.project;
			const config = input.configs[index]!;
			const grantId = `${key}:grant:${config.starter}`;
			await input.adminClient.createCapacityGrant(input.runtime.teamId, {
				schemaVersion: 2, id: grantId, membershipId: input.runtime.membershipId, providerId: input.runtime.providerId,
				projectId: project.id, environment: 'local', status: 'planned', executionProviderIds: ['codex'], laneIds: [],
				capabilities: config.capabilities, allowedModes: config.allowedModes,
				dailyCreditLimit: config.credits, monthlyCreditLimit: config.credits, maxConcurrentAssignments: 1,
				metadata: { liveAcceptance: true, runId: input.runId, concurrentStarters: true, starter: config.starter },
			}, `${key}:grant-create:${config.starter}`);
			await input.adminClient.transitionCapacityGrant(input.runtime.teamId, grantId, 'activate', `${key}:grant-activate:${config.starter}`);
			grants.push({ grantId, projectId: project.id, teamId: input.runtime.teamId, grantScope: 'project' });
		}
		const durationSeconds = Math.max(...input.configs.map(localStarterDurationSeconds));
		const allocationId = `${key}:allocation`;
		const allocation = await input.adminClient.createCapacityAllocationSet(input.runtime.teamId, {
			id: allocationId, effectiveFrom: new Date(Date.now() - 1_000).toISOString(),
			effectiveUntil: new Date(Date.now() + (durationSeconds + 300) * 1_000).toISOString(),
			reservePolicy: { percent: 0, overflow: 'deny' }, borrowingRules: [],
			slices: projects.map((entry, index) => ({ id: `${allocationId}:${input.configs[index]!.starter}`, scope: 'project', targetId: entry.project.id, policy: { minPercent: 0, targetPercent: 50, maxPercent: 60, hardCapPercent: 60 } })),
			metadata: { liveAcceptance: true, runId: input.runId, concurrentStarters: true },
		}, `${key}:allocation-create`);
		const active = (await input.adminClient.capacityAllocationSets(input.runtime.teamId, { limit: 200 })).payload.items
			.find((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).status === 'active') as Record<string, unknown> | undefined;
		await input.adminClient.supersedeCapacityAllocationSet(input.runtime.teamId, String(allocation.payload.id), { expectedActiveAllocationSetId: active?.id ?? null }, `${key}:allocation-supersede`);
		availability = await protocol.refreshAvailabilitySession(sessionId, {
			expectedSequence: availability.payload.sequence, environment: 'local', status: 'open', capabilities, grants,
			nativeLimits: { availableCredits: credits, maxConcurrentRunners: 2 }, runnerPressure: { activeRunners: 0, maxConcurrentRunners: 2 },
			metadata: { liveAcceptance: true, runId: input.runId, concurrentStarters: true }, executionProviders: [executionProvider],
		});
		availabilitySequence = Number(availability.payload.sequence);
		// One provider-bound workday is the portfolio scheduling boundary. Its two
		// project envelopes can run concurrently; creating two local workday runs
		// would intentionally supersede the first under the local successor contract.
		const workdayRunId = `${key}:run:portfolio`;
		await input.adminClient.createWorkdayRun(input.runtime.teamId, {
			id: workdayRunId, capacityProviderId: input.runtime.providerId, environment: 'local', status: 'running',
			parameters: {
				projects: projects.map((entry) => entry.project.slug), durationSeconds,
				allocationSetId: allocation.payload.id, availableCredits: credits, planningOnly: true,
				metadata: { liveAcceptance: true, concurrentStarters: true },
			},
		});
		workdayRunIds.push(workdayRunId);
		return {
			projects, workdayRunIds, allocationId: String(allocation.payload.id), grants, capabilities,
			connection: { ...input.runtime, providerAccessToken: access.accessToken, providerSessionId: sessionId, providerSessionSequence: availabilitySequence },
			cleanup,
		};
	} catch (error) {
		await cleanup('cancelled').catch((cleanupError) => { throw new AggregateError([error, cleanupError], 'Concurrent starter provisioning and cleanup both failed.'); });
		throw error;
	}
}
