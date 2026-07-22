import { MarketClient } from '../market-client.ts';
import { bindLocalCapacityTreeDxRepository } from './live-acceptance-capacity-context.ts';

export const LOCAL_CAPACITY_ACCEPTANCE_TEAM_PREFIX = 'capacity-live-acceptance-';
export const LOCAL_CAPACITY_GOVERNANCE_TEAM_PREFIX = 'capacity-live-governance-';

export function isLocalCapacityAcceptanceTeam(team: Record<string, unknown>) {
	const name = typeof team.name === 'string' ? team.name : '';
	const metadata = team.metadata && typeof team.metadata === 'object' && !Array.isArray(team.metadata)
		? team.metadata as Record<string, unknown>
		: {};
	return metadata.liveAcceptance === true
		&& (
			name.startsWith(LOCAL_CAPACITY_ACCEPTANCE_TEAM_PREFIX)
			|| name.startsWith(LOCAL_CAPACITY_GOVERNANCE_TEAM_PREFIX)
		);
}

function runSuffix(runId: string) {
	return runId.replace(/[^a-z0-9]/giu, '').toLowerCase().slice(-14) || 'run';
}

async function waitForProjectDeletion(adminClient: MarketClient, teamId: string, projectId: string) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const projects = await adminClient.projects(teamId);
		if (!(projects.payload as Array<Record<string, unknown>>).some((entry) => entry.id === projectId)) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error(`Capacity acceptance project ${projectId} did not reach deleted state.`);
}

async function waitForTeamDeletionReadiness(adminClient: MarketClient, teamId: string) {
	let blockers: Array<Record<string, unknown>> = [];
	for (let attempt = 0; attempt < 300; attempt += 1) {
		blockers = (await adminClient.teamDeletionBlockers(teamId)).payload;
		if (blockers.length === 0) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
	}
	throw new Error(`Capacity acceptance team ${teamId} still has deletion blockers after project cleanup: ${blockers.map((entry) => `${String(entry.code)}:${String(entry.id ?? '')}`).join(', ')}.`);
}

async function terminalizeProjectCapacity(
	adminClient: MarketClient,
	teamId: string,
	projectId: string,
) {
	const runs = await adminClient.workdayRuns(teamId, { limit: 200 });
	if (runs.payload.page.hasMore) {
		throw new Error(`Capacity acceptance team ${teamId} has more workday runs than bounded cleanup can safely inspect.`);
	}
	for (const run of runs.payload.items) {
		const runId = typeof run.id === 'string' ? run.id : '';
		const status = typeof run.status === 'string' ? run.status : '';
		if (!runId || !['queued', 'running'].includes(status)) continue;
		await adminClient.updateWorkdayRun(teamId, runId, { status: 'cancelled' });
	}
	const before = await adminClient.projectDeletionBlockers(projectId);
	for (const blocker of before.payload) {
		if (blocker.code !== 'active_workday' || typeof blocker.id !== 'string') continue;
		await adminClient.cancelWorkday(
			blocker.id,
			`capacity-acceptance-cleanup:${blocker.id}:cancel`,
		);
	}
	const assignments = await adminClient.capacityProviderAssignments(teamId, { projectId, limit: 200 });
	for (const assignment of assignments.payload.items as Array<Record<string, unknown>>) {
		const assignmentId = typeof assignment.id === 'string' ? assignment.id : '';
		const status = typeof assignment.status === 'string' ? assignment.status : '';
		if (!assignmentId || !['pending', 'returned', 'expired'].includes(status)) continue;
		await adminClient.cancelCapacityAssignment(teamId, assignmentId, {
			idempotencyKey: `capacity-acceptance-cleanup:${assignmentId}:cancel`,
			reason: 'Isolated live-acceptance team cleanup resolved the abandoned assignment.',
		});
	}
	const remaining = (await adminClient.projectDeletionBlockers(projectId)).payload;
	if (remaining.length > 0) {
		throw new Error(`Capacity acceptance project ${projectId} still has deletion blockers: ${remaining.map((entry) => `${String(entry.code)}:${String(entry.id ?? '')}`).join(', ')}.`);
	}
}

export async function deleteLocalCapacityAcceptanceTeam(
	adminClient: MarketClient,
	team: { id: string; name: string },
) {
	const projects = await adminClient.projects(team.id);
	for (const project of projects.payload as Array<Record<string, unknown>>) {
		const projectId = typeof project.id === 'string' ? project.id : '';
		const projectSlug = typeof project.slug === 'string' ? project.slug : projectId;
		if (!projectId) continue;
		await terminalizeProjectCapacity(adminClient, team.id, projectId);
		await adminClient.deleteProject(projectId, `DELETE ${projectSlug}`);
		await waitForProjectDeletion(adminClient, team.id, projectId);
	}
	await waitForTeamDeletionReadiness(adminClient, team.id);
	const deleted = await adminClient.deleteTeam(team.id, `DELETE ${team.name}`);
	if (!deleted.ok) {
		throw new Error(`Capacity acceptance could not delete isolated team ${team.id}: ${deleted.message ?? deleted.code ?? 'unknown error'}.`);
	}
}

export async function createLocalCapacityAcceptanceScope(
	adminClient: MarketClient,
	runId: string,
) {
	const suffix = runSuffix(runId);
	const name = `${LOCAL_CAPACITY_ACCEPTANCE_TEAM_PREFIX}${suffix}`;
	const createdTeam = await adminClient.createTeam({
		name,
		displayName: `Capacity live acceptance ${suffix}`,
		metadata: { liveAcceptance: true, runId, purpose: 'isolated-capacity-runtime' },
	});
	const teamId = createdTeam.payload.id;
	const cleanup = () => deleteLocalCapacityAcceptanceTeam(adminClient, { id: teamId, name });
	try {
		const createdProject = await adminClient.createProject(teamId, {
			slug: `capacity-${suffix}`,
			name: `Capacity acceptance ${suffix}`,
			description: 'Isolated control-plane project for the local capacity acceptance lifecycle.',
			metadata: {
				liveAcceptance: true,
				runId,
				purpose: 'isolated-capacity-runtime',
				architecture: {
					topology: 'single_repository_site',
					rootPath: '.',
					sitePath: '.',
					contentPath: 'src/content',
					contentRuntimeSource: 'treedx_snapshot',
					localContentMaterialization: 'none',
				},
			},
		});
		const payload = createdProject.payload as Record<string, unknown>;
		const nested = payload.project && typeof payload.project === 'object' && !Array.isArray(payload.project)
			? payload.project as Record<string, unknown>
			: payload;
		const projectId = String(nested.id ?? '');
		const projectSlug = String(nested.slug ?? '');
		if (!projectId || !projectSlug) throw new Error('Capacity acceptance project creation omitted its id or slug.');
		await bindLocalCapacityTreeDxRepository(adminClient, {
			projectId,
			projectSlug,
			teamId,
		}, {
			repositoryName: 'treeseed-market',
			contentPath: 'src/content',
		});
		return {
			teamId,
			projectId,
			projectSlug,
			cleanup,
		};
	} catch (error) {
		await cleanup().catch((cleanupError) => {
			throw new AggregateError([error, cleanupError], 'Capacity acceptance scope provisioning and cleanup both failed.');
		});
		throw error;
	}
}
