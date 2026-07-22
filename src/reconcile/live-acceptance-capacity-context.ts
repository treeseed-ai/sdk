import { MarketClient } from '../market-client.ts';
import {
	capacityProviderPublicIdentity,
	generateCapacityProviderIdentity,
	ProviderProtocolClient,
	signCapacityProviderProof,
} from '../capacity-provider.ts';
import { TreeDxClient } from '../treedx/client.ts';
import { mintTreeDxHs256Token } from '../treedx/auth.ts';
import type { TreeseedLiveReconcileEnvironment } from './live-acceptance.ts';
import { configuredLiveAcceptanceValue, type LiveAcceptanceEnv } from './live-acceptance-values.ts';
import type { CapacityGovernanceAcceptanceProof } from './live-acceptance-capacity-governance.ts';

export function capacityAcceptanceConfig(env: LiveAcceptanceEnv, environment: TreeseedLiveReconcileEnvironment) {
	const local = environment === 'local';
	const apiUrl = configuredLiveAcceptanceValue(env, [
		'TREESEED_CAPACITY_ACCEPTANCE_API_URL',
		'TREESEED_MARKET_URL',
		'TREESEED_API_BASE_URL',
	]) || (local ? 'http://127.0.0.1:3000' : '');
	const adminToken = configuredLiveAcceptanceValue(env, ['TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN'])
		|| (local ? 'tsk_local_treeseed_acceptance_admin' : '');
	const teamId = configuredLiveAcceptanceValue(env, ['TREESEED_CAPACITY_ACCEPTANCE_TEAM_ID']);
	const projectId = configuredLiveAcceptanceValue(env, ['TREESEED_CAPACITY_ACCEPTANCE_PROJECT_ID']);
	const projectSlug = configuredLiveAcceptanceValue(env, ['TREESEED_CAPACITY_ACCEPTANCE_PROJECT_SLUG']);
	const providerId = configuredLiveAcceptanceValue(env, ['TREESEED_CAPACITY_ACCEPTANCE_PROVIDER_ID']);
	const membershipId = configuredLiveAcceptanceValue(env, ['TREESEED_CAPACITY_ACCEPTANCE_MEMBERSHIP_ID']);
	const agentClassId = configuredLiveAcceptanceValue(env, ['TREESEED_CAPACITY_ACCEPTANCE_AGENT_CLASS_ID'])
		|| (local ? 'planning' : '');
	const providerAccessToken = configuredLiveAcceptanceValue(env, ['TREESEED_CAPACITY_ACCEPTANCE_PROVIDER_ACCESS_TOKEN']);
	const missing = [
		['TREESEED_CAPACITY_ACCEPTANCE_API_URL or TREESEED_MARKET_URL', apiUrl],
		['TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN', adminToken],
		...(!local ? [
			['TREESEED_CAPACITY_ACCEPTANCE_TEAM_ID', teamId],
			['TREESEED_CAPACITY_ACCEPTANCE_PROJECT_ID', projectId],
		] : []),
		...(!local ? [
			['TREESEED_CAPACITY_ACCEPTANCE_PROVIDER_ID or TREESEED_CAPACITY_PROVIDER_ID', providerId],
			['TREESEED_CAPACITY_ACCEPTANCE_MEMBERSHIP_ID', membershipId],
		] : []),
		['TREESEED_CAPACITY_ACCEPTANCE_AGENT_CLASS_ID', agentClassId],
		...(!local ? [['TREESEED_CAPACITY_ACCEPTANCE_PROVIDER_ACCESS_TOKEN', providerAccessToken]] : []),
	].filter(([, value]) => !value).map(([key]) => String(key));
	return { apiUrl, adminToken, teamId, projectId, projectSlug, providerId, membershipId, agentClassId, providerAccessToken, missing };
}

export async function resolveLocalCapacityAcceptanceScope(adminClient: MarketClient, configuredProjectId: string) {
	const projects = await adminClient.projects();
	const records = (Array.isArray(projects.payload) ? projects.payload : [])
		.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)));
	const project = records.find((entry) => configuredProjectId && entry.id === configuredProjectId)
		?? records.find((entry) => entry.slug === 'market')
		?? records[0];
	const projectId = typeof project?.id === 'string' ? project.id : '';
	const teamId = typeof project?.teamId === 'string' ? project.teamId : '';
	if (!projectId || !teamId) throw new Error('Local capacity acceptance could not resolve a project and owning team through the public project API.');
	return { projectId, projectSlug: typeof project?.slug === 'string' ? project.slug : projectId, teamId };
}

export async function bindLocalCapacityTreeDxRepository(
	adminClient: MarketClient,
	scope: { projectId: string; projectSlug: string; teamId: string },
	input: { repositoryName: string; contentPath: string },
) {
	const current = await adminClient.projectTreeDxLibrary(scope.projectId);
	if (current.payload?.repositoryId) return current.payload;
	const baseUrl = 'http://127.0.0.1:4000';
	let instance = (await adminClient.teamTreeDx(scope.teamId)).payload.instance;
	if (!instance || instance.status !== 'active') {
		instance = (await adminClient.updateTeamTreeDx(scope.teamId, {
			id: `local-treedx-${scope.teamId}`, kind: 'self_hosted', provider: 'self_hosted', name: 'Local reconciled TreeDX',
			baseUrl, registryUrl: baseUrl, status: 'active', metadata: { source: 'local_reconciliation', contentCanonical: 'treedx' },
		})).payload.instance;
	}
	const token = mintTreeDxHs256Token({
		secret: 'treeseed-local-treedx-jwt-secret', issuer: 'https://api.treeseed.local/treedx', audience: 'treedx-local',
		actorId: 'treeseed-api', tenantId: 'treeseed-control-plane', repoIds: ['*'], capabilities: ['*'], refs: ['*'], paths: ['**'], ttlSeconds: 300,
	});
	const repositories = await new TreeDxClient({ baseUrl, token, timeoutMs: 30_000 }).listRepositories();
	const repositoryName = input.repositoryName;
	const repository = repositories.find((entry) => entry.repositoryName === repositoryName || entry.name === repositoryName);
	if (!repository?.repoId) throw new Error(`Local TreeDX repository ${repositoryName} is not registered.`);
	return (await adminClient.upsertProjectTreeDxLibrary(scope.projectId, {
		instanceId: instance.id, libraryId: `${scope.teamId}/${scope.projectSlug}`, repositoryId: repository.repoId,
		contentPath: input.contentPath,
		metadata: { source: 'local_reconciliation', repositoryName },
	})).payload;
}

export function ensureLocalCapacityTreeDxBinding(adminClient: MarketClient, scope: { projectId: string; projectSlug: string; teamId: string }) {
	return bindLocalCapacityTreeDxRepository(adminClient, scope, {
		repositoryName: `treeseed-${scope.projectSlug}`,
		contentPath: scope.projectSlug === 'market' ? 'src/content' : 'docs/src/content',
	});
}

function activityMode(value: unknown) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	return (value as Record<string, unknown>).activityType === 'acting' ? 'acting' : 'planning';
}

export async function syncLocalAcceptanceAgentClasses(adminClient: MarketClient, input: {
	projectId: string;
	repositoryId: string;
	agentPaths: string[];
	runId: string;
}) {
	const response = await adminClient.treeDxReadRepositoryFiles(input.projectId, input.repositoryId, {
		ref: 'refs/heads/main', paths: input.agentPaths, encoding: 'utf8', parseFrontmatter: true,
	});
	const payload = response.payload && typeof response.payload === 'object' ? response.payload as Record<string, unknown> : {};
	const resolvedRef = typeof payload.resolvedRef === 'string' ? payload.resolvedRef.trim() : '';
	if (!/^[a-f0-9]{40}$/u.test(resolvedRef)) throw new Error('Capacity acceptance did not resolve the starter repository to an immutable TreeDX commit.');
	const files = Array.isArray(payload.files) ? payload.files : [];
	if (files.length !== input.agentPaths.length) throw new Error(`Capacity acceptance loaded ${files.length}/${input.agentPaths.length} starter agent definitions through TreeDX.`);
	const existing = (await adminClient.projectAgentClasses(input.projectId, { limit: 200 })).payload.items;
	const results = [];
	for (const entry of files) {
		const file = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
		const frontmatter = file.frontmatter && typeof file.frontmatter === 'object' && !Array.isArray(file.frontmatter) ? file.frontmatter as Record<string, unknown> : null;
		if (!frontmatter) throw new Error(`Capacity acceptance could not parse starter agent definition ${String(file.path ?? 'unknown')}.`);
		const classId = String(frontmatter.projectAgentClassId ?? frontmatter.agentClass ?? '').trim();
		const agentSlug = String(frontmatter.slug ?? '').trim();
		const activities = frontmatter.activityProfiles && typeof frontmatter.activityProfiles === 'object' && !Array.isArray(frontmatter.activityProfiles)
			? frontmatter.activityProfiles as Record<string, unknown>
			: {};
		if (!classId || !agentSlug || Object.keys(activities).length === 0) throw new Error(`Starter agent definition ${String(file.path ?? 'unknown')} omitted its class, slug, or activity profiles.`);
		const allowedModes = [...new Set(Object.values(activities).map(activityMode).filter((mode): mode is 'planning' | 'acting' => Boolean(mode)))];
		const record = existing.find((candidate) => candidate.id === classId || candidate.slug === classId);
		const scopedClassId = `${input.projectId}:${classId}`;
		const body = {
			id: scopedClassId, slug: classId, name: String(frontmatter.name ?? frontmatter.title ?? classId), status: 'active',
			allowedModes, requiredCapabilities: [classId],
			handlerRefs: { agents: [{ slug: agentSlug, activities }] },
			metadata: { source: 'treedx_starter_agent_content_sync', contentPath: file.path, template: frontmatter.template ?? null },
		};
		results.push(await (record
			? adminClient.updateProjectAgentClass(input.projectId, String(record.id), body, `capacity-acceptance:${input.runId}:${input.projectId}:agent-class-update:${classId}`)
			: adminClient.createProjectAgentClass(input.projectId, body, `capacity-acceptance:${input.runId}:${input.projectId}:agent-class-create:${classId}`)));
	}
	return { agentClasses: results, resolvedRef };
}

export async function syncLocalAcceptanceAgentClass(adminClient: MarketClient, input: { projectId: string; agentClassId: string; runId: string }) {
	const library = (await adminClient.projectTreeDxLibrary(input.projectId)).payload;
	if (!library?.repositoryId) throw new Error('Capacity acceptance cannot sync agent configuration without a TreeDX repository binding.');
	const response = await adminClient.treeDxReadRepositoryFiles(input.projectId, library.repositoryId, {
		ref: 'refs/heads/main', paths: ['src/content/agents/tester.mdx'], encoding: 'utf8', parseFrontmatter: true,
	});
	const payload = response.payload && typeof response.payload === 'object' ? response.payload as Record<string, unknown> : {};
	const files = Array.isArray(payload.files) ? payload.files : [];
	const file = files.find((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).path === 'src/content/agents/tester.mdx') as Record<string, unknown> | undefined;
	const frontmatter = file?.frontmatter && typeof file.frontmatter === 'object' && !Array.isArray(file.frontmatter) ? file.frontmatter as Record<string, unknown> : null;
	if (!frontmatter) throw new Error('Capacity acceptance could not load the tester activity profiles through TreeDX.');
	const activities = frontmatter.activityProfiles && typeof frontmatter.activityProfiles === 'object' && !Array.isArray(frontmatter.activityProfiles) ? frontmatter.activityProfiles as Record<string, unknown> : {};
	const identity = frontmatter.identity && typeof frontmatter.identity === 'object' && !Array.isArray(frontmatter.identity) ? frontmatter.identity as Record<string, unknown> : {};
	const classes = await adminClient.projectAgentClasses(input.projectId, { limit: 200 });
	const existing = classes.payload.items.find((entry) => entry.id === input.agentClassId || entry.slug === input.agentClassId);
	const body = {
		id: input.agentClassId, slug: input.agentClassId, name: 'Testing agents', status: 'active',
		allowedModes: ['planning', 'acting'], requiredCapabilities: ['repo_read', 'agent_mode_run'],
		handlerRefs: { agents: [{ slug: typeof frontmatter.slug === 'string' ? frontmatter.slug : 'tester', activities: Object.fromEntries(Object.entries(activities).filter(([, value]) => value && typeof value === 'object')) }] },
		metadata: { source: 'treedx_project_agent_content_sync', contentPath: file.path, purpose: typeof identity.purpose === 'string' ? identity.purpose : null },
	};
	return existing
		? adminClient.updateProjectAgentClass(input.projectId, String(existing.id), body, `capacity-acceptance:${input.runId}:agent-class-update`)
		: adminClient.createProjectAgentClass(input.projectId, body, `capacity-acceptance:${input.runId}:agent-class-create`);
}

export async function provisionLocalCapacityAcceptanceProvider(input: { adminClient: MarketClient; apiUrl: string; teamId: string; runId: string; fetchImpl: typeof fetch }) {
	const privateJwk = generateCapacityProviderIdentity();
	const publicJwk = capacityProviderPublicIdentity(privateJwk);
	const protocol = new ProviderProtocolClient({ marketUrl: input.apiUrl, fetchImpl: input.fetchImpl, userAgent: `treeseed-live-acceptance/${input.runId}` });
	const key = await input.adminClient.revealTeamCapacityRegistrationKey(input.teamId);
	const unsigned = {
		schemaVersion: 1 as const, displayName: `Treeseed isolated acceptance ${input.runId}`, publicJwk,
		capabilitySummary: ['planning', 'agent_mode_run', 'repo_read', 'usage_report'],
		supplyOffer: { weight: 1, maxConcurrentRunners: 1, capabilities: ['planning', 'agent_mode_run', 'repo_read', 'usage_report'] },
		metadata: { liveAcceptance: true, runId: input.runId },
	};
	const registrationProof = await signCapacityProviderProof({ privateJwk, publicJwk, method: 'POST', path: '/v1/provider-registrations', audience: input.apiUrl, body: unsigned });
	const request = await protocol.register(key.payload.registrationKey, { ...unsigned, proof: registrationProof }, `capacity-acceptance:${input.runId}:register`);
	const approved = await input.adminClient.reviewCapacityProviderRegistration(input.teamId, request.id, 'approve', `capacity-acceptance:${input.runId}:approve`, { teamAlias: `acceptance-${input.runId}` });
	if (approved.payload.status !== 'approved' || !approved.payload.membershipId) throw new Error('Capacity acceptance provider registration was not approved with a membership.');
	const exchangeIdempotencyKey = `capacity-acceptance:${input.runId}:credential`;
	const exchangePath = `/v1/provider-registrations/${encodeURIComponent(request.id)}/credential`;
	const exchangeProof = await signCapacityProviderProof({ privateJwk, publicJwk, method: 'POST', path: exchangePath, audience: input.apiUrl, body: { requestId: request.id, idempotencyKey: exchangeIdempotencyKey } });
	const credential = await protocol.exchangeCredential(request.id, exchangeProof, exchangeIdempotencyKey);
	const accessIdempotencyKey = `capacity-acceptance:${input.runId}:access`;
	const accessProof = await signCapacityProviderProof({ privateJwk, publicJwk, method: 'POST', path: '/v1/provider/access-tokens', audience: input.apiUrl, body: { credentialId: credential.id, idempotencyKey: accessIdempotencyKey } });
	const access = await protocol.issueAccessToken(credential.credential, credential.id, accessProof, accessIdempotencyKey);
	return {
		providerId: request.providerId, membershipId: approved.payload.membershipId, providerAccessToken: access.accessToken,
		credentialId: credential.id, membershipCredential: credential.credential, privateJwk,
		cleanup: () => input.adminClient.revokeCapacityProviderMembership(input.teamId, approved.payload.membershipId!, `capacity-acceptance:${input.runId}:revoke`),
	};
}

export interface CapacityAcceptanceProof {
	sessionId: string;
	assignmentId: string;
	modeRunId: string;
	finalStatus: string;
	mode: string;
	runnerId: string;
	modeRunCount: number;
	artifactCount: number;
	toolEventCount: number;
	usageActualCount: number;
	ledgerEntryCount: number;
	starterPlanning?: {
		starter: 'research';
		projectId: string;
		assignmentId: string;
		agentId: string;
		handlerId: string;
		artifactCount: number;
		usageActualCount: number;
		ledgerEntryCount: number;
		completedAssignments?: number;
		workflowStatus?: string;
		citationCount?: number;
		revisionCount?: number;
	};
	starterEngineering?: {
		starter: 'engineering';
		projectId: string;
		assignmentId: string;
		completedAssignments: number;
		artifactCount: number;
		usageActualCount: number;
		ledgerEntryCount: number;
		graphStatus: string;
		graphNodeCount: number;
		revisionNodeCount: number;
		exactBaseRef: string;
		participatingAgents: string[];
	};
	starterConcurrency?: {
		projectIds: string[];
		assignmentIds: string[];
		workspaceIds: string[];
		overlapMs: number;
		artifactCount: number;
		usageActualCount: number;
		ledgerEntryCount: number;
	};
	governance?: CapacityGovernanceAcceptanceProof;
}

export function capacityGrantForAcceptance(grants: unknown[], config: ReturnType<typeof capacityAcceptanceConfig>, environment: TreeseedLiveReconcileEnvironment) {
	return grants.map((entry) => entry && typeof entry === 'object' ? entry as Record<string, unknown> : null).find((grant) =>
		grant && grant.id
		&& (grant.providerId === config.providerId || grant.capacityProviderId === config.providerId)
		&& grant.projectId === config.projectId
		&& (grant.teamId === config.teamId || !grant.teamId)
		&& (grant.status === 'active' || grant.state === 'active')
		&& (grant.environment === environment || !grant.environment)) ?? null;
}

export function effectiveActiveAllocation(allocations: unknown[], now = Date.now()) {
	return allocations.map((entry) => entry && typeof entry === 'object' ? entry as Record<string, unknown> : null).find((allocation) => {
		if (!allocation?.id || allocation.status !== 'active') return false;
		const effectiveFrom = typeof allocation.effectiveFrom === 'string' ? Date.parse(allocation.effectiveFrom) : Number.NaN;
		const effectiveUntil = typeof allocation.effectiveUntil === 'string' ? Date.parse(allocation.effectiveUntil) : null;
		return Number.isFinite(effectiveFrom) && effectiveFrom <= now && (effectiveUntil === null || (Number.isFinite(effectiveUntil) && effectiveUntil > now));
	}) ?? null;
}

export async function createTreeDxProxyAuditEvidence(input: { fetchImpl: typeof fetch; apiUrl: string; providerAccessToken: string; projectId: string; assignmentId: string; runId: string }) {
	const response = await input.fetchImpl(`${input.apiUrl.replace(/\/$/u, '')}/v1/dx/projects/${encodeURIComponent(input.projectId)}/repos/${encodeURIComponent(`capacity-proof-${input.runId}`)}/files/read`, {
		method: 'POST',
		headers: { accept: 'application/json', authorization: `Bearer ${input.providerAccessToken}`, 'content-type': 'application/json', 'x-treeseed-assignment-id': input.assignmentId },
		body: JSON.stringify({ paths: [`src/content/agent-platform-proof/${input.runId}.mdx`], ref: 'HEAD' }),
	});
	if (response.status !== 403) {
		const body = await response.text().catch(() => '');
		throw new Error(`Capacity acceptance TreeDX proxy audit probe expected 403 but received ${response.status}${body ? `: ${body}` : ''}.`);
	}
}
