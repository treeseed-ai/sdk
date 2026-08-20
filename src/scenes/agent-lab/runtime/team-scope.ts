import type { MarketClient } from '../../../entrypoints/clients/market-client.ts';

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function resourceKey(value: Row) {
	const metadata = row(value.metadata);
	return text(row(metadata.seed).resourceKey) || text(metadata.resourceKey) || text(metadata.seedResourceKey) || text(value.seedResourceKey);
}

export async function resolveTeamAgentLabRuntime(input: {
	client: MarketClient; teamKey: string; providerKey: string; repositories: string[];
	authorityScope: { teamId: string; projectId: string };
}) {
	if (input.repositories.length !== 1) throw new Error('Team Agent Lab currently requires exactly one selected project per scene.');
	const teamSlug = input.teamKey.replace(/^team:/u, '').split('/').at(-1) ?? '';
	const teamId = text(input.authorityScope.teamId);
	const expectedProjectId = text(input.authorityScope.projectId);
	if (!teamId || !expectedProjectId) throw new Error('Agent Lab received an incomplete authoritative team and project scope.');
	const projects = (await input.client.projects(teamId)).payload.map(row);
	const repositorySlug = input.repositories[0]!;
	const projectKey = repositorySlug.startsWith('project:') ? repositorySlug : `project:treeseed/${repositorySlug}`;
	const project = projects.find((entry) => text(entry.id) === expectedProjectId);
	const projectId = text(project?.id);
	if (!projectId) throw new Error(`Agent Lab authoritative project ${expectedProjectId} is not a member of team ${teamId}.`);
	if (resourceKey(project) !== projectKey && text(project.slug) !== repositorySlug) {
		throw new Error(`Agent Lab authoritative project ${expectedProjectId} does not match selected repository ${repositorySlug}.`);
	}
	const grants = (await input.client.capacityGrants(teamId, { limit: 200 })).payload.items.map(row);
	const grant = grants.find((entry) => resourceKey(entry) === input.providerKey && text(entry.projectId) === projectId && text(entry.status) === 'active');
	if (!grant) throw new Error(`Agent Lab found no active seeded grant for project ${projectKey}.`);
	const providerId = text(grant.providerId); const membershipId = text(grant.membershipId);
	if (!providerId || !membershipId) throw new Error(`Agent Lab seeded grant for project ${projectKey} has no provider membership binding.`);
	const allocations = (await input.client.capacityAllocationSets(teamId, { limit: 200 })).payload.items.map(row);
	const allocation = allocations.find((entry) => text(entry.status) === 'active' && row(entry.metadata).seedRuntime === true);
	if (!allocation) throw new Error('Agent Lab found no active seeded portfolio allocation.');
	return {
		scope: { teamId, projectId, projectSlug: text(project.slug) || repositorySlug, cleanup: async () => undefined },
		provider: { providerId, membershipId },
		grantId: text(grant.id), allocation,
		teamName: teamSlug || input.teamKey,
	};
}
