import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import {
	capacityProviderPublicIdentity,
	generateCapacityProviderIdentity,
	ProviderProtocolClient,
	signCapacityProviderProof,
	type CapacityProviderManifestV2,
	type CapacityProviderPrivateJwk,
} from '../../capacity/providers/capacity-provider.ts';
import { MarketClient } from '../../entrypoints/clients/market-client.ts';
import { MarketClientError } from '../../entrypoints/clients/market-client.ts';
import type { SeedAgentLabServicePrincipalPrerequisite, SeedCapacityProviderPrerequisite, SeedPlan } from '../types.ts';

type Json = Record<string, unknown>;

export type LocalSeedRuntimeResult = {
	providers: Array<{ key: string; teamId: string; providerId: string; membershipId: string; projectIds: string[]; grantIds: string[]; allocationId: string; runtimeManifestPath: string }>;
	servicePrincipals: Array<{ key: string; teamId: string; serviceId: string; membershipId: string | null; credentialPath: string }>;
};

function object(value: unknown): Json {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

function string(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stableId(prefix: string, key: string) {
	return `${prefix}-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

export function seedAllocationActivationKey(allocationId: string, expectedActiveAllocationSetId: string | null) {
	return `seed-runtime:${allocationId}:activate:${expectedActiveAllocationSetId ?? 'none'}`;
}

export function seedAllocationRevisionId(providerKey: string, expectedActiveAllocationSetId: string) {
	return stableId('seed-allocation-revision', `${providerKey}:${expectedActiveAllocationSetId}`);
}

async function atomicWrite(path: string, value: string, mode = 0o600) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, value, { encoding: 'utf8', mode });
	await rename(temporary, path);
	await chmod(path, mode);
}

async function readJson(path: string): Promise<Json | null> {
	if (!existsSync(path)) return null;
	return object(JSON.parse(await readFile(path, 'utf8')));
}

function selectedProviders(plan: SeedPlan) {
	return plan.runtime.capacityProviders.filter((provider) => {
		const environments = provider.environments ?? plan.environments;
		return environments.some((environment) => plan.environments.includes(environment));
	});
}

function selectedServicePrincipals(plan: SeedPlan) {
	return plan.runtime.agentLabServicePrincipals.filter((principal) => (principal.environments ?? plan.environments).some((environment) => plan.environments.includes(environment)));
}

function providerDataDir(projectRoot: string, provider: SeedCapacityProviderPrerequisite) {
	const identity = provider.key.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').toLowerCase();
	return resolve(projectRoot, '.treeseed/local-capacity-providers', `${provider.providerClass}-${identity}`);
}

async function resolveTeam(client: MarketClient, plan: SeedPlan, prerequisite: SeedAgentLabServicePrincipalPrerequisite) {
	const action = plan.actions.find((candidate) => candidate.kind === 'team' && candidate.key === prerequisite.team); const actionId = string(action?.existing?.id);
	if (actionId) return actionId;
	const resource = (await client.resolveSeedResources([prerequisite.team])).payload[0];
	const teamId = string(resource?.id); if (!teamId) throw new Error(`Agent Lab service principal ${prerequisite.key} could not resolve team ${prerequisite.team}.`); return teamId;
}

async function reconcileServicePrincipal(input: { client: MarketClient; plan: SeedPlan; principal: SeedAgentLabServicePrincipalPrerequisite; projectRoot: string }) {
	const teamId = await resolveTeam(input.client, input.plan, input.principal);
	const result = await input.client.request<{ ok: true; payload: { serviceId: string; credential: string; membershipId: string | null } }>(`/v1/teams/${encodeURIComponent(teamId)}/agent-lab/service-principal/reconcile`, { method: 'POST', requireAuth: true, body: { resourceKey: input.principal.key, name: input.principal.name } });
	const credentialPath = resolve(input.projectRoot, '.treeseed/agent-lab/runtime', `${result.payload.serviceId}.credential`);
	await atomicWrite(credentialPath, `${result.payload.credential.trim()}\n`);
	await atomicWrite(resolve(input.projectRoot, '.treeseed/agent-lab/runtime', 'service-principal.json'), `${JSON.stringify({ schemaVersion: 1, teamId, serviceId: result.payload.serviceId, membershipId: result.payload.membershipId, credentialPath, resourceKey: input.principal.key, updatedAt: new Date().toISOString() }, null, 2)}\n`);
	return { key: input.principal.key, teamId, serviceId: result.payload.serviceId, membershipId: result.payload.membershipId, credentialPath };
}

async function resolveResources(client: MarketClient, plan: SeedPlan, provider: SeedCapacityProviderPrerequisite, fallbackTeamId?: string | null) {
	const teamAction = plan.actions.find((action) => action.kind === 'team' && action.key === provider.team);
	let teamId = string(teamAction?.existing?.id) ?? fallbackTeamId ?? null;
	const unresolvedKeys = [
		...(!teamId ? [provider.team] : []),
		...provider.projects.filter((key) => !string(plan.actions.find((candidate) => candidate.kind === 'project' && candidate.key === key)?.existing?.id)),
	];
	const resolved = unresolvedKeys.length > 0
		? new Map((await client.resolveSeedResources(unresolvedKeys)).payload.map((resource) => [resource.key, resource]))
		: new Map<string, { id: string }>();
	teamId = teamId ?? string(resolved.get(provider.team)?.id);
	if (!teamId) throw new Error(`Seed capacity prerequisite ${provider.key} could not resolve team ${provider.team}.`);
	const projectIds = provider.projects.map((key) => {
		const action = plan.actions.find((candidate) => candidate.kind === 'project' && candidate.key === key);
		const actionId = string(action?.existing?.id);
		if (actionId) return actionId;
		const id = string(resolved.get(key)?.id);
		if (!id) throw new Error(`Seed capacity prerequisite ${provider.key} could not resolve project ${key}.`);
		return id;
	});
	return { teamId, projectIds };
}

async function resolveProjectCapabilities(client: MarketClient, projectIds: string[]) {
	const capabilities = new Set<string>();
	for (const projectId of projectIds) {
		const classes = (await client.projectAgentClasses(projectId, { limit: 200 })).payload.items.map(object);
		for (const agentClass of classes) {
			for (const capability of Array.isArray(agentClass.requiredCapabilities) ? agentClass.requiredCapabilities : []) {
				if (string(capability)) capabilities.add(String(capability));
			}
		}
	}
	return [...capabilities].sort();
}

async function loadIdentity(path: string): Promise<CapacityProviderPrivateJwk> {
	const existing = await readJson(path);
	if (existing?.d) return existing as unknown as CapacityProviderPrivateJwk;
	const identity = generateCapacityProviderIdentity();
	await atomicWrite(path, `${JSON.stringify(identity)}\n`);
	return identity;
}

async function verifyOrRepairCredential(input: {
	client: MarketClient; protocol: ProviderProtocolClient; apiUrl: string; providerKey: string; dataDir: string;
	privateJwk: CapacityProviderPrivateJwk; publicJwk: ReturnType<typeof capacityProviderPublicIdentity>; state: Json;
}) {
	const credentialId = string(input.state.credentialId);
	const membershipId = string(input.state.membershipId);
	const requestId = string(input.state.registrationRequestId);
	const credentialRef = string(input.state.generatedCredentialRef);
	if (!credentialId || !membershipId || !requestId || !credentialRef) return { state: input.state, accessToken: null };
	const credentialPath = resolve(input.dataDir, credentialRef.replace(/^data:\/\//u, ''));
	const credential = (await readFile(credentialPath, 'utf8')).trim();
	const verifyKey = `seed-runtime:${input.providerKey}:credential-verify:${Date.now()}`;
	const verifyBody = { credentialId, idempotencyKey: verifyKey };
	const verifyProof = await signCapacityProviderProof({ privateJwk: input.privateJwk, publicJwk: input.publicJwk, method: 'POST', path: '/v1/provider/access-tokens', audience: input.apiUrl, body: verifyBody });
	try {
		const issued = await input.protocol.issueAccessToken(credential, credentialId, verifyProof, verifyKey);
		return { state: input.state, accessToken: issued.accessToken };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/credential (?:is invalid|identifier does not match|is not active)/iu.test(message)) throw error;
	}
	const rotationKey = `seed-runtime:${input.providerKey}:credential-repair:${credentialId}`;
	const authorization = await input.client.authorizeCapacityProviderCredentialRotation(String(input.state.teamId), membershipId, rotationKey);
	const exchangeKey = `seed-runtime:${input.providerKey}:credential:${authorization.payload.generation}`;
	const exchangePath = `/v1/provider-registrations/${encodeURIComponent(requestId)}/credential`;
	const exchangeBody = { requestId, idempotencyKey: exchangeKey };
	const exchangeProof = await signCapacityProviderProof({ privateJwk: input.privateJwk, publicJwk: input.publicJwk, method: 'POST', path: exchangePath, audience: input.apiUrl, body: exchangeBody });
	const issued = await input.protocol.exchangeCredential(requestId, exchangeProof, exchangeKey);
	await atomicWrite(credentialPath, `${issued.credential.trim()}\n`);
	const repairedState = { ...input.state, credentialId: issued.id, credentialRepair: { priorCredentialId: credentialId, repairedAt: new Date().toISOString() } };
	const accessKey = `seed-runtime:${input.providerKey}:credential-verify:${issued.id}`;
	const accessBody = { credentialId: issued.id, idempotencyKey: accessKey };
	const accessProof = await signCapacityProviderProof({ privateJwk: input.privateJwk, publicJwk: input.publicJwk, method: 'POST', path: '/v1/provider/access-tokens', audience: input.apiUrl, body: accessBody });
	const access = await input.protocol.issueAccessToken(issued.credential, issued.id, accessProof, accessKey);
	return { state: repairedState, accessToken: access.accessToken };
}

async function publishExecutionProviderInventory(input: {
	apiUrl: string;
	accessToken: string;
	provider: SeedCapacityProviderPrerequisite;
	executionProviders: CapacityProviderManifestV2['executionProviders'];
	capabilities: string[];
	maxConcurrentRunners: number;
}) {
	const protocol = new ProviderProtocolClient({ marketUrl: input.apiUrl, accessToken: input.accessToken, userAgent: 'treeseed-seed-runtime/1' });
	const session = await protocol.createAvailabilitySession({
		ttlSeconds: 90,
		environment: 'local',
		status: 'open',
		availableFrom: new Date().toISOString(),
		availableUntil: null,
		executionProviders: input.executionProviders.map((provider) => ({ ...provider, status: 'active' })),
		capabilities: input.capabilities,
		nativeLimits: { maxConcurrentRunners: input.maxConcurrentRunners },
		runnerPressure: { activeRunners: 0, maxConcurrentRunners: input.maxConcurrentRunners },
		constraints: { outboundOnly: true },
		metadata: { source: 'treeseed-seed-runtime', seedResourceKey: input.provider.key, inventoryOnly: true },
	});
	await protocol.closeAvailabilitySession(session.payload.id);
}

async function provisionConnection(input: {
	client: MarketClient; apiUrl: string; provider: SeedCapacityProviderPrerequisite; baseManifest: CapacityProviderManifestV2;
	dataDir: string; runtimeManifestPath: string; teamId: string; projectCapabilities: string[];
}) {
	const connectionStatePath = resolve(input.dataDir, 'connections', `${input.provider.connectionId}.json`);
	const existingState = await readJson(connectionStatePath);
	const sourceConnection = input.baseManifest.connections.find((entry) => entry.id === input.provider.connectionId);
	let state = existingState ?? (sourceConnection ? {
		teamId: sourceConnection.teamId, providerId: sourceConnection.providerId, membershipId: sourceConnection.membershipId,
		credentialId: sourceConnection.membershipCredentialId, generatedCredentialRef: sourceConnection.membershipCredentialRef,
	} : null);
	const identityPath = resolve(input.dataDir, 'identity.json');
	const privateJwk = await loadIdentity(identityPath);
	const publicJwk = capacityProviderPublicIdentity(privateJwk);
	const protocol = new ProviderProtocolClient({ marketUrl: input.apiUrl, userAgent: 'treeseed-seed-runtime/1' });
	const executionProviders = input.baseManifest.executionProviders.filter((entry) => input.provider.executionProviderIds.includes(entry.id));
	const maxConcurrentRunners = Math.max(1, ...executionProviders.map((entry) => Number(entry.nativeLimits.maxConcurrentRunners ?? 1)).filter(Number.isFinite));
	const capabilities = [...new Set([...executionProviders.flatMap((entry) => entry.capabilities), ...input.projectCapabilities])].sort();
	const capabilityDigest = createHash('sha256').update(`${capabilities.join('\0')}\0${maxConcurrentRunners}`).digest('hex');
	if (!state?.membershipId || !state.providerId || !state.credentialId || !state.generatedCredentialRef || state.teamId !== input.teamId) {
		let key;
		try {
			key = await input.client.revealTeamCapacityRegistrationKey(input.teamId);
		} catch (error) {
			const payload = error instanceof MarketClientError ? object(error.payload) : {};
			if (string(payload.code) !== 'registration_key_reveal_invalid') throw error;
			const current = await input.client.teamCapacityRegistrationKey(input.teamId);
			key = await input.client.rotateTeamCapacityRegistrationKey(
				input.teamId,
				`seed-runtime:${input.provider.key}:repair-registration-key:${current.payload.generation}`,
			);
		}
		const body = {
			schemaVersion: 1 as const, displayName: input.baseManifest.identity.displayName, publicJwk,
			capabilitySummary: capabilities,
			supplyOffer: { weight: 1, maxConcurrentRunners, capabilities },
			metadata: { seedRuntime: true, seedResourceKey: input.provider.key },
		};
		const proof = await signCapacityProviderProof({ privateJwk, publicJwk, method: 'POST', path: '/v1/provider-registrations', audience: input.apiUrl, body });
		const request = await protocol.register(key.payload.registrationKey, { ...body, proof }, `seed-runtime:${input.provider.key}:register:${capabilityDigest}`);
		const approved = await input.client.reviewCapacityProviderRegistration(input.teamId, request.id, 'approve', `seed-runtime:${input.provider.key}:approve:${capabilityDigest}`, { teamAlias: input.provider.connectionId });
		if (approved.payload.status !== 'approved' || !approved.payload.membershipId) throw new Error(`Seed provider ${input.provider.key} was not approved.`);
		const credentialKey = `seed-runtime:${input.provider.key}:credential:${capabilityDigest}`;
		const credentialPath = `/v1/provider-registrations/${encodeURIComponent(request.id)}/credential`;
		const credentialProof = await signCapacityProviderProof({ privateJwk, publicJwk, method: 'POST', path: credentialPath, audience: input.apiUrl, body: { requestId: request.id, idempotencyKey: credentialKey } });
		const credential = await protocol.exchangeCredential(request.id, credentialProof, credentialKey);
		const credentialRef = `data://secrets/${input.provider.connectionId}.credential`;
		await atomicWrite(resolve(input.dataDir, 'secrets', `${input.provider.connectionId}.credential`), `${credential.credential.trim()}\n`);
		state = { teamId: input.teamId, providerId: request.providerId, membershipId: approved.payload.membershipId, credentialId: credential.id, generatedCredentialRef: credentialRef, registrationRequestId: request.id, registrationStatus: 'approved', capabilityDigest };
		await atomicWrite(connectionStatePath, `${JSON.stringify({ schemaVersion: 1, connectionId: input.provider.connectionId, marketUrl: input.apiUrl, marketProfile: 'local', marketAudience: input.apiUrl, ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
	}
	const credential = await verifyOrRepairCredential({ client: input.client, protocol, apiUrl: input.apiUrl, providerKey: input.provider.key, dataDir: input.dataDir, privateJwk, publicJwk, state: state ?? {} });
	state = credential.state;
	if (state?.capabilityDigest !== capabilityDigest) {
		state = { ...state, capabilityDigest };
	}
	await atomicWrite(connectionStatePath, `${JSON.stringify({ schemaVersion: 1, connectionId: input.provider.connectionId, marketUrl: input.apiUrl, marketProfile: 'local', marketAudience: input.apiUrl, ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
	for (const executionProvider of executionProviders) executionProvider.capabilities = capabilities;
	const connection = {
		id: input.provider.connectionId, marketProfile: 'local', marketAudience: input.apiUrl, teamId: String(state.teamId),
		providerId: String(state.providerId), membershipId: String(state.membershipId), membershipCredentialRef: String(state.generatedCredentialRef),
		membershipCredentialId: String(state.credentialId), offer: { weight: 1, maxConcurrentRunners, capabilities },
	};
	const runtimeManifest = { ...input.baseManifest, executionProviders, connections: [connection] };
	await atomicWrite(input.runtimeManifestPath, stringify(runtimeManifest));
	if (!credential.accessToken) throw new Error(`Seed provider ${input.provider.key} could not issue a provider access token.`);
	await publishExecutionProviderInventory({ apiUrl: input.apiUrl, accessToken: credential.accessToken, provider: input.provider, executionProviders, capabilities, maxConcurrentRunners });
	return { providerId: connection.providerId, membershipId: connection.membershipId, capabilities, maxConcurrentRunners };
}

async function reconcilePolicy(input: { client: MarketClient; provider: SeedCapacityProviderPrerequisite; teamId: string; projectIds: string[]; providerId: string; membershipId: string; capabilities: string[]; maxConcurrentRunners: number }) {
	const existingGrants = (await input.client.capacityGrants(input.teamId, { limit: 200 })).payload.items.map(object);
	const grantIds: string[] = [];
	for (const projectId of input.projectIds) {
		const id = stableId('seed-grant', `${input.provider.key}:${projectId}:${input.capabilities.join(',')}:time-v2:${input.maxConcurrentRunners}`);
		grantIds.push(id);
		const overlaps = existingGrants.filter((grant) =>
			string(grant.id) !== id
			&& string(grant.membershipId) === input.membershipId
			&& string(grant.providerId) === input.providerId
			&& string(grant.projectId) === projectId
			&& string(grant.status) === 'active',
		);
		for (const overlap of overlaps) {
			const overlapId = string(overlap.id);
			if (overlapId) await input.client.transitionCapacityGrant(
				input.teamId, overlapId, 'revoke', `seed-runtime:${id}:retire-overlap:${overlapId}`,
			);
		}
		const existing = existingGrants.find((grant) => string(grant.id) === id);
		if (!existing) {
			await input.client.createCapacityGrant(input.teamId, {
				schemaVersion: 2, id, membershipId: input.membershipId, providerId: input.providerId, projectId, environment: 'local', status: 'planned',
				executionProviderIds: input.provider.executionProviderIds, laneIds: [], capabilities: input.capabilities,
				allowedModes: input.provider.allowedModes, dailyAgentSecondsLimit: 28_800, monthlyAgentSecondsLimit: 864_000, maxConcurrentAssignments: input.maxConcurrentRunners,
				metadata: { seedRuntime: true, seedResourceKey: input.provider.key },
			}, `seed-runtime:${id}:create`);
			await input.client.transitionCapacityGrant(input.teamId, id, 'activate', `seed-runtime:${id}:activate`);
		} else if (string(existing.status) !== 'active') {
			await input.client.transitionCapacityGrant(input.teamId, id, 'activate', `seed-runtime:${id}:activate`);
		}
	}
	const baseAllocationId = stableId('seed-allocation', input.provider.key);
	const allocations = (await input.client.capacityAllocationSets(input.teamId, { limit: 200 })).payload.items.map(object);
	const activeAllocation = allocations.find((entry) => string(entry.status) === 'active');
	let allocationId = baseAllocationId;
	let allocation = allocations.find((entry) => string(entry.id) === allocationId);
	if (allocation && ['superseded', 'archived'].includes(string(allocation.status) ?? '')) {
		const expectedActiveAllocationSetId = string(activeAllocation?.id);
		if (!expectedActiveAllocationSetId) throw new Error('A superseded seed allocation requires an active replacement before a new revision can be reconciled.');
		allocationId = seedAllocationRevisionId(input.provider.key, expectedActiveAllocationSetId);
		allocation = allocations.find((entry) => string(entry.id) === allocationId);
	}
	if (!allocation) {
		const target = 100 / input.projectIds.length;
		const created = await input.client.createCapacityAllocationSet(input.teamId, {
			id: allocationId, effectiveFrom: new Date(Date.now() - 1_000).toISOString(), effectiveUntil: '2100-01-01T00:00:00.000Z',
			reservePolicy: { percent: 0, overflow: 'deny' },
			slices: input.projectIds.map((projectId) => ({ id: `${allocationId}:${projectId}`, scope: 'project', targetId: projectId, policy: { minPercent: 0, targetPercent: target, maxPercent: 100, hardCapPercent: 100 } })),
			borrowingRules: [], metadata: { seedRuntime: true, seedResourceKey: input.provider.key },
		}, `seed-runtime:${allocationId}:create`);
		allocation = created.payload;
	}
	if (string(allocation.status) !== 'active') {
		const expectedActiveAllocationSetId = string(activeAllocation?.id);
		await input.client.supersedeCapacityAllocationSet(
			input.teamId,
			allocationId,
			{ expectedActiveAllocationSetId },
			seedAllocationActivationKey(allocationId, expectedActiveAllocationSetId),
		);
	}
	return { grantIds, allocationId };
}

export async function reconcileLocalSeedRuntime(input: { projectRoot: string; plan: SeedPlan; accessToken: string; apiUrl?: string; env?: NodeJS.ProcessEnv }): Promise<LocalSeedRuntimeResult> {
	const apiUrl = input.apiUrl ?? input.env?.TREESEED_MARKET_PROFILE_LOCAL_URL?.trim() ?? 'http://127.0.0.1:3000';
	const client = new MarketClient({ profile: { id: 'local', label: 'Local', baseUrl: apiUrl, kind: 'specialized' }, accessToken: input.accessToken, userAgent: 'treeseed-seed-runtime/1' });
	const servicePrincipals = [];
	for (const principal of selectedServicePrincipals(input.plan)) servicePrincipals.push(await reconcileServicePrincipal({ client, plan: input.plan, principal, projectRoot: input.projectRoot }));
	const providers = [];
	for (const provider of selectedProviders(input.plan)) {
		const dataDir = providerDataDir(input.projectRoot, provider);
		const connectionState = await readJson(resolve(dataDir, 'connections', `${provider.connectionId}.json`));
		const { teamId, projectIds } = await resolveResources(client, input.plan, provider, string(connectionState?.teamId));
		const baseManifestPath = resolve(input.projectRoot, provider.manifest);
		const baseManifest = parse(await readFile(baseManifestPath, 'utf8')) as CapacityProviderManifestV2;
		const runtimeManifestPath = resolve(dataDir, 'runtime', 'provider-manifest.yaml');
		const projectCapabilities = await resolveProjectCapabilities(client, projectIds);
		const connection = await provisionConnection({ client, apiUrl, provider, baseManifest, dataDir, runtimeManifestPath, teamId, projectCapabilities });
		const policy = await reconcilePolicy({ client, provider, teamId, projectIds, ...connection });
		providers.push({ key: provider.key, teamId, projectIds, runtimeManifestPath, ...connection, ...policy });
	}
	return { providers, servicePrincipals };
}
