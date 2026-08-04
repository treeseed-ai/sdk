import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { capacityProviderPublicIdentity, ProviderProtocolClient, signCapacityProviderProof, type CapacityProviderManifestV2, type CapacityProviderPrivateJwk } from '../../../capacity/providers/capacity-provider.ts';
import type { MarketClient } from '../../../entrypoints/clients/market-client.ts';

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function resourceKey(value: Row) {
	const metadata = row(value.metadata);
	return text(row(metadata.seed).resourceKey) || text(metadata.resourceKey) || text(value.seedResourceKey);
}

export async function resolveTeamAgentLabRuntime(input: {
	projectRoot: string; client: MarketClient; apiUrl: string; teamKey: string; providerKey: string; repositories: string[];
}) {
	const manifestPath = resolve(input.projectRoot, '.treeseed/local-capacity-provider/data/runtime/provider-manifest.yaml');
	const manifest = parse(await readFile(manifestPath, 'utf8')) as CapacityProviderManifestV2;
	const connection = manifest.connections[0];
	if (!connection) throw new Error(`Agent Lab seeded provider ${input.providerKey} has no runtime connection.`);
	const teamId = text(connection.teamId);
	if (!teamId) throw new Error(`Agent Lab seeded provider ${input.providerKey} has no team binding.`);
	if (input.repositories.length !== 1) throw new Error('Team Agent Lab currently requires exactly one selected project per scene.');
	const projects = (await input.client.projects(teamId)).payload.map(row);
	const repositorySlug = input.repositories[0]!;
	const projectKey = repositorySlug.startsWith('project:') ? repositorySlug : `project:treeseed/${repositorySlug}`;
	const project = projects.find((entry) => resourceKey(entry) === projectKey) ?? projects.find((entry) => text(entry.slug) === repositorySlug);
	const projectId = text(project?.id);
	if (!projectId) throw new Error(`Agent Lab could not resolve seeded project ${projectKey}.`);
	const dataDir = resolve(input.projectRoot, '.treeseed/local-capacity-provider/data');
	const privateJwk = JSON.parse(await readFile(resolve(dataDir, 'identity.json'), 'utf8')) as CapacityProviderPrivateJwk;
	const credentialPath = resolve(dataDir, connection.membershipCredentialRef.replace(/^data:\/\//u, ''));
	const membershipCredential = (await readFile(credentialPath, 'utf8')).trim();
	const publicJwk = capacityProviderPublicIdentity(privateJwk);
	const idempotencyKey = `agent-lab:team:${teamId}:${Date.now()}:access`;
	const body = { credentialId: connection.membershipCredentialId, idempotencyKey };
	const proof = await signCapacityProviderProof({ privateJwk, publicJwk, method: 'POST', path: '/v1/provider/access-tokens', audience: connection.marketAudience, body });
	const access = await new ProviderProtocolClient({ marketUrl: input.apiUrl }).issueAccessToken(membershipCredential, connection.membershipCredentialId, proof, idempotencyKey);
	const grants = (await input.client.capacityGrants(teamId, { limit: 200 })).payload.items.map(row);
	const grant = grants.find((entry) => text(entry.membershipId) === connection.membershipId && text(entry.projectId) === projectId && text(entry.status) === 'active');
	if (!grant) throw new Error(`Agent Lab found no active seeded grant for project ${projectKey}.`);
	const allocations = (await input.client.capacityAllocationSets(teamId, { limit: 200 })).payload.items.map(row);
	const allocation = allocations.find((entry) => text(entry.status) === 'active' && row(entry.metadata).seedRuntime === true);
	if (!allocation) throw new Error('Agent Lab found no active seeded portfolio allocation.');
	return {
		scope: { teamId, projectId, projectSlug: text(project.slug) || repositorySlug, cleanup: async () => undefined },
		provider: { providerId: connection.providerId, membershipId: connection.membershipId, credentialId: connection.membershipCredentialId, membershipCredential, providerAccessToken: access.accessToken, privateJwk, cleanup: async () => undefined },
		grantId: text(grant.id), allocation,
		teamName: input.teamKey.split('/').at(-1) || input.teamKey,
	};
}
