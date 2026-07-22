import { resolve } from 'node:path';
import { MarketClient } from '../market-client.ts';
import { runTreeseedGitText } from '../operations/services/git-runner.ts';
import type { CapacityGovernanceRuntimeConnection } from './live-acceptance-capacity-governance.ts';
import type { CapacityAcceptanceProof } from './live-acceptance-capacity-context.ts';
import type { TreeseedCapacityAcceptanceExecutionInput } from './live-acceptance-capacity-executor.ts';
import type { RunTreeseedLiveReconcileTestsOptions } from './live-acceptance.ts';
import { verifyCapacityAcceptanceTerminal } from './live-acceptance-capacity-terminal.ts';
import { engineeringStarterCapacityConfig } from './live-acceptance-starter-engineering.ts';
import { researchStarterCapacityConfig } from './live-acceptance-starter-planning.ts';
import { finalizeLocalStarterAcceptance, provisionLocalStarterPortfolioCapacity } from './live-acceptance-starter-runtime.ts';

const DECISION_ID = 'normalize-release-channel-inputs';

export function concurrentProjectClassTransitionKey(
	runId: string,
	projectId: string,
	transition: string,
	classSlug: string,
) {
	return `concurrent-starters:${runId}:project:${projectId}:${transition}:${classSlug}`;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function timestamp(value: unknown) {
	const parsed = Date.parse(String(value ?? ''));
	return Number.isFinite(parsed) ? parsed : 0;
}

function workspaceId(assignment: Record<string, unknown>) {
	return String(record(assignment.treedxProxyHandle).workspaceId
		?? record(record(assignment.workspaceContext).treedxProxyHandle).workspaceId
		?? '');
}

export function hasConcurrentUsageAndExactlyOnceSettlement(
	terminals: Array<{ usageActualCount: number; ledgerEntryCount: number }>,
) {
	return terminals.every((terminal) => terminal.usageActualCount > 0 && terminal.ledgerEntryCount === 1);
}

export async function runLocalConcurrentStarterAcceptance(input: {
	adminClient: MarketClient;
	apiUrl: string;
	runId: string;
	runtime: CapacityGovernanceRuntimeConnection;
	fetchImpl: typeof fetch;
	privateJwk: TreeseedCapacityAcceptanceExecutionInput['privateJwk'];
	executor: NonNullable<RunTreeseedLiveReconcileTestsOptions['capacityAssignmentExecutor']>;
}): Promise<NonNullable<CapacityAcceptanceProof['starterConcurrency']>> {
	const engineeringRoot = resolve(process.cwd(), 'starters/engineering');
	const exactBaseRef = runTreeseedGitText(['rev-parse', 'HEAD'], { cwd: engineeringRoot, mode: 'read' }).trim();
	if (!/^[a-f0-9]{40}$/u.test(exactBaseRef)) throw new Error('Concurrent starter acceptance could not resolve the engineering exact source commit.');
	const portfolio = await provisionLocalStarterPortfolioCapacity({
		...input,
		configs: [engineeringStarterCapacityConfig(`${input.runId}-concurrent`, exactBaseRef), researchStarterCapacityConfig()],
	});
	const engineering = portfolio.projects[0]!;
	const research = portfolio.projects[1]!;
	let executionError: unknown;
	try {
		for (const classSlug of ['engineering', 'release', 'reporting', 'research', 'review', 'technical-writing', 'testing']) {
			await input.adminClient.updateProjectAgentClass(engineering.project.id, `${engineering.project.id}:${classSlug}`, { status: 'paused' }, concurrentProjectClassTransitionKey(input.runId, engineering.project.id, 'pause', classSlug));
		}
		await input.adminClient.updateProjectAgentClass(engineering.project.id, `${engineering.project.id}:architecture`, { status: 'active', allowedModes: ['planning'] }, concurrentProjectClassTransitionKey(input.runId, engineering.project.id, 'activate', 'architecture'));
		await Promise.all([
			input.adminClient.updateProjectAgentClass(research.project.id, `${research.project.id}:research`, { status: 'active', allowedModes: ['planning'] }, concurrentProjectClassTransitionKey(input.runId, research.project.id, 'activate', 'research')),
			...['review', 'technical-writing', 'reporting'].map((classSlug) => input.adminClient.updateProjectAgentClass(research.project.id, `${research.project.id}:${classSlug}`, { status: 'paused', allowedModes: ['planning'] }, concurrentProjectClassTransitionKey(input.runId, research.project.id, 'pause', classSlug))),
		]);
		await input.adminClient.createPlanningInputRequest(DECISION_ID, {
			id: `concurrent-engineering-proposal:${input.runId}`, projectId: engineering.project.id,
			projectAgentClassId: `${engineering.project.id}:architecture`, mode: 'planning',
			prompt: 'Create the linked test-first release-channel proposal.',
			metadata: { agentId: 'architect', objectiveId: 'ship-the-first-guided-change', planningSource: 'concurrent-live-proposal', priority: 100 },
		});
		const workflowId = `concurrent-research:${input.runId}`;
		await input.adminClient.createResearchWorkflow(research.project.id, {
			id: workflowId, objectiveRef: 'objective:publish-the-first-knowledge-pack',
			questionRef: 'question:what-should-this-research-map-first', minimumIndependentSources: 2, maxRevisionCycles: 3,
			idempotencyKey: `${workflowId}:create`, metadata: { liveAcceptance: true, concurrentStarters: true },
		});
		await Promise.all(portfolio.workdayRunIds.map((runId, index) => input.adminClient.tickWorkdayRun(input.runtime.teamId, runId, {
			idempotencyKey: `concurrent-starters:${input.runId}:tick:${index}`,
		})));
		const execution = await input.executor({
			runId: `${input.runId}-concurrent-starters`, apiUrl: input.apiUrl,
			teamId: portfolio.connection.teamId, projectId: engineering.project.id,
			providerId: portfolio.connection.providerId, membershipId: portfolio.connection.membershipId,
			credentialId: portfolio.connection.credentialId, membershipCredential: portfolio.connection.membershipCredential,
			providerAccessToken: portfolio.connection.providerAccessToken,
			providerSessionId: portfolio.connection.providerSessionId, providerSessionSequence: portfolio.connection.providerSessionSequence,
			privateJwk: input.privateJwk, assignmentId: null, expectedAssignmentCount: 2, maxConcurrentRunners: 2,
			executionProviderId: 'codex', capabilities: portfolio.capabilities,
		});
		const assignmentIds = execution.assignmentIds ?? [execution.assignmentId];
		if (assignmentIds.length !== 2) throw new Error(`Concurrent provider execution returned ${assignmentIds.length} assignments instead of two.`);
		const assignments = await Promise.all(assignmentIds.map(async (assignmentId) =>
			(await input.adminClient.capacityProviderAssignment(input.runtime.teamId, assignmentId)).payload));
		const expectedProjects = new Set([engineering.project.id, research.project.id]);
		if (new Set(assignments.map((assignment) => String(assignment.projectId))).size !== 2
			|| assignments.some((assignment) => !expectedProjects.has(String(assignment.projectId)))) {
			throw new Error(`Concurrent provider assignments crossed project scope: ${JSON.stringify(assignments.map((entry) => ({ id: entry.id, projectId: entry.projectId })))}`);
		}
		const terminals = await Promise.all(assignments.map((assignment) => verifyCapacityAcceptanceTerminal({
			adminClient: input.adminClient,
			config: { teamId: input.runtime.teamId, projectId: String(assignment.projectId) },
			assignmentId: String(assignment.id), minimumArtifactCount: 1,
		})));
		const starts = assignments.map((assignment) => timestamp(assignment.claimedAt ?? assignment.assignedAt));
		const ends = assignments.map((assignment) => timestamp(assignment.completedAt ?? assignment.updatedAt));
		const overlapMs = Math.min(...ends) - Math.max(...starts);
		if (starts.some((value) => value === 0) || ends.some((value) => value === 0) || overlapMs <= 0) {
			throw new Error(`Concurrent assignments did not retain overlapping durable lease intervals: ${JSON.stringify({ starts, ends, overlapMs })}`);
		}
		const workspaceIds = assignments.map(workspaceId);
		if (workspaceIds.some((id) => !id) || new Set(workspaceIds).size !== 2) throw new Error('Concurrent assignments did not retain independent TreeDX workspaces.');
		if (!hasConcurrentUsageAndExactlyOnceSettlement(terminals)) {
			throw new Error(`Concurrent assignments did not retain usage evidence and exactly one ledger settlement per project: ${JSON.stringify(terminals)}`);
		}
		return {
			projectIds: [...expectedProjects], assignmentIds, workspaceIds, overlapMs,
			usageActualCount: terminals.reduce((total, terminal) => total + terminal.usageActualCount, 0),
			ledgerEntryCount: terminals.reduce((total, terminal) => total + terminal.ledgerEntryCount, 0),
			artifactCount: terminals.reduce((total, terminal) => total + terminal.artifactCount, 0),
		};
	} catch (error) {
		executionError = error;
		throw error;
	} finally {
		await finalizeLocalStarterAcceptance(portfolio.cleanup, executionError, 'Concurrent starter');
	}
}
