import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { IacClient } from 'railway';
import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../railway-cli.ts';
import { resolveTreeseedRailwayApiToken } from '../../../service-credentials.ts';
import { railwayGraphqlRequest, resolveRailwayWorkspaceContext } from './collect-railway-volumes.ts';
import { normalizeConnectionNodes, railwayConnectionLabel } from './default-railway-api-url.ts';
import { normalizeEnvironment, normalizeProject, normalizeServiceInstanceService } from './normalize-workspace.ts';

export async function listRailwayProjects({
	env = process.env,
	workspaceId,
	fetchImpl = fetch,
}: {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	workspaceId: string;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		projects?: { edges?: Array<{ node?: Record<string, unknown> | null } | null> } | null;
	}>({
		query: `
query TreeseedRailwayProjects($workspaceId: String!, $first: Int!) {
	projects(workspaceId: $workspaceId, first: $first) {
		edges {
			node {
				id
				name
				workspaceId
				deletedAt
				environments(first: 50) {
					edges {
						node {
							id
							name
						}
					}
				}
				services(first: 50) {
					edges {
						node {
							id
							name
						}
					}
				}
			}
		}
	}
}
`.trim(),
		variables: { workspaceId, first: 100 },
		env,
		fetchImpl,
	});
	return normalizeConnectionNodes(payload.data?.projects, normalizeProject);
}

export async function getRailwayProject({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		project?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayProject($projectId: String!) {
	project(id: $projectId) {
		id
		name
		workspaceId
		deletedAt
		environments(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
		services(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
	}
}
`.trim(),
		variables: { projectId },
		env,
		fetchImpl,
	});
	return payload.data?.project ? normalizeProject(payload.data.project) : null;
}

export async function ensureRailwayProject({
	projectName,
	projectId,
	defaultEnvironmentName = 'staging',
	env = process.env,
	workspace,
	fetchImpl = fetch,
}: {
	projectName?: string | null;
	projectId?: string | null;
	defaultEnvironmentName?: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	workspace?: string;
	fetchImpl?: typeof fetch;
}) {
	const workspaceContext = await resolveRailwayWorkspaceContext({ env, workspace, fetchImpl });
	const projects = await listRailwayProjects({ env, workspaceId: workspaceContext.id, fetchImpl });
	const desiredProjectName = railwayConnectionLabel(projectName);
	const desiredProjectId = railwayConnectionLabel(projectId);
	const existing = projects.find((project) =>
		!project.deletedAt && (
			(desiredProjectId && project.id === desiredProjectId)
			|| (desiredProjectName && project.name === desiredProjectName)
		),
	) ?? null;
	if (existing) {
		return { workspace: workspaceContext, project: existing, created: false };
	}
	if (!desiredProjectName) {
		throw new Error('Railway project creation requires a project name.');
	}
	void defaultEnvironmentName;
	const tempRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-railway-init-'));
	try {
		await runRailwayCliJson({ args: ['init', '--name', desiredProjectName, '--workspace', workspaceContext.id, '--json'], env, cwd: tempRoot });
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
	const project = (await listRailwayProjects({ env, workspaceId: workspaceContext.id, fetchImpl }))
		.find((entry) => entry.name === desiredProjectName && !entry.deletedAt) ?? null;
	if (!project) {
		throw new Error(`Railway project create did not return a usable project for ${desiredProjectName}.`);
	}
	return { workspace: workspaceContext, project, created: true };
}

export async function ensureRailwayEnvironment({
	projectId,
	environmentName,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentName: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const environments = await listRailwayEnvironments({ projectId, env, fetchImpl });
	const existing = environments.find((environment) => environment.name === environmentName || environment.id === environmentName) ?? null;
	if (existing) {
		return { environment: existing, created: false };
	}
	const tempRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-railway-environment-'));
	try {
		await runRailwayCliJson({ args: ['link', projectId, '--json'], env, cwd: tempRoot });
		await runRailwayCliJson({ args: ['environment', 'new', environmentName, '--json'], env, cwd: tempRoot });
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
	const environment = (await listRailwayEnvironments({ projectId, env, fetchImpl }))
		.find((entry) => entry.name === environmentName) ?? null;
	if (!environment) {
		throw new Error(`Railway environment create did not return a usable environment for ${environmentName}.`);
	}
	return { environment, created: true };
}

export async function listRailwayEnvironments({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		project?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayProjectEnvironments($projectId: String!) {
	project(id: $projectId) {
		id
		environments(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
	}
}
`.trim(),
		variables: { projectId },
		env,
		fetchImpl,
	});
	return normalizeConnectionNodes(payload.data?.project ? (payload.data.project as Record<string, unknown>).environments : null, normalizeEnvironment);
}

export async function listRailwayEnvironmentServices({
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		environment?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayEnvironmentServices($environmentId: String!) {
	environment(id: $environmentId) {
		id
		name
		serviceInstances(first: 100) {
			edges {
				node {
					id
					serviceId
					serviceName
					environmentId
				}
			}
		}
	}
}
`.trim(),
		variables: { environmentId },
		env,
		fetchImpl,
	});
	return normalizeConnectionNodes(
		payload.data?.environment ? (payload.data.environment as Record<string, unknown>).serviceInstances : null,
		normalizeServiceInstanceService,
	);
}
