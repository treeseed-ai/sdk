import { resolve } from 'node:path';
import { MarketClient } from '../market-client.ts';
import { runTreeseedGitText } from '../operations/services/git-runner.ts';
import type { CapacityGovernanceRuntimeConnection } from './live-acceptance-capacity-governance.ts';
import type { CapacityAcceptanceProof } from './live-acceptance-capacity-context.ts';
import type { TreeseedCapacityAcceptanceExecutionInput } from './live-acceptance-capacity-executor.ts';
import type { RunTreeseedLiveReconcileTestsOptions } from './live-acceptance.ts';
import { verifyCapacityAcceptanceTerminal } from './live-acceptance-capacity-terminal.ts';
import { provisionLocalStarterCapacity } from './live-acceptance-starter-runtime.ts';

const AGENTS = ['architect', 'engineer', 'releaser', 'reporter', 'researcher', 'reviewer', 'technical-writer', 'tester']
	.map((slug) => `template/src/content/agents/${slug}.mdx`);
const CAPABILITIES = [
	'planning', 'repo_read', 'repo_write', 'agent_mode_run', 'usage_report',
	'architecture', 'engineering', 'release', 'reporting', 'research', 'review', 'technical-writing', 'testing',
	'engineering:research', 'engineering:architecture', 'engineering:test', 'engineering:implementation',
	'engineering:verification', 'engineering:review', 'engineering:documentation', 'engineering:release',
];
const DECISION_ID = 'normalize-release-channel-inputs';
const OBJECTIVE_ID = 'ship-the-first-guided-change';

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function graphNodes(graph: Record<string, unknown>) {
	return Array.isArray(graph.nodes) ? graph.nodes.map(record) : [];
}

export async function runLocalEngineeringStarterAcceptance(input: {
	adminClient: MarketClient;
	apiUrl: string;
	runId: string;
	runtime: CapacityGovernanceRuntimeConnection;
	fetchImpl: typeof fetch;
	privateJwk: TreeseedCapacityAcceptanceExecutionInput['privateJwk'];
	executor: NonNullable<RunTreeseedLiveReconcileTestsOptions['capacityAssignmentExecutor']>;
}): Promise<NonNullable<CapacityAcceptanceProof['starterEngineering']>> {
	const repositoryRoot = resolve(process.cwd(), 'starters/engineering');
	const exactBaseRef = runTreeseedGitText(['rev-parse', 'HEAD'], { cwd: repositoryRoot, mode: 'read' }).trim();
	if (!/^[a-f0-9]{40}$/u.test(exactBaseRef)) throw new Error('Engineering starter acceptance could not resolve an exact source commit.');
	const starter = await provisionLocalStarterCapacity({
		...input,
		config: {
			starter: 'engineering', repositoryName: 'treeseed-starter-engineering', agentPaths: AGENTS,
			capabilities: CAPABILITIES, allowedModes: ['planning', 'acting'], credits: 64,
			parameters: ({ projectId }) => ({
				engineeringWorkflows: [{
					schemaVersion: 1, id: `engineering-workflow:${input.runId}`, projectId,
					decisionId: DECISION_ID, objectiveId: OBJECTIVE_ID, exactBaseRef,
					roles: { tester: 'testing', engineer: 'engineering', reviewer: 'review', technicalWriter: 'technical-writing', releaser: 'release', researcher: 'research', architect: 'architecture' },
					includeResearch: true, includeArchitecture: true, requireLinkedProposal: true,
					metadata: { liveAcceptance: true, requireRevisionCycle: true },
				}],
			}),
			projectMetadata: {
				architecture: { topology: 'single_repository_site', rootPath: 'template', sitePath: 'template', contentPath: 'template/src/content', contentRuntimeSource: 'treedx_snapshot', localContentMaterialization: 'existing_path' },
				repository: { provider: 'git', owner: 'treeseed-templates', name: 'engineering', defaultBranch: 'main', checkoutPath: 'starters/engineering', cloneUrl: 'https://github.com/treeseed-templates/engineering.git' },
				agentSpecs: { root: 'template/src/content/agents', testsRoot: 'template/src/content/agent-tests' },
			},
		},
	});
	let sequence = starter.connection.providerSessionSequence;
	let completedAssignments = 0;
	let artifactCount = 0;
	let usageActualCount = 0;
	let ledgerEntryCount = 0;
	const agents = new Set<string>();
	const setClassState = async (classSlug: string, body: Record<string, unknown>, transition: string) => {
		const classId = `${starter.project.id}:${classSlug}`;
		return input.adminClient.updateProjectAgentClass(
			starter.project.id,
			classId,
			body,
			`engineering-starter:${input.runId}:${transition}:${classSlug}`,
		);
	};
	const executeNext = async (label: string, expectedArtifacts?: number) => {
		await input.adminClient.tickWorkdayRun(starter.connection.teamId, starter.workdayRunId, {
			idempotencyKey: `engineering-starter:${input.runId}:tick:${label}`,
		});
		const execution = await input.executor({
			runId: `${input.runId}-engineering-${label}`, apiUrl: input.apiUrl, repositoryRoot,
			teamId: starter.connection.teamId, projectId: starter.project.id,
			providerId: starter.connection.providerId, membershipId: starter.connection.membershipId,
			credentialId: starter.connection.credentialId, membershipCredential: starter.connection.membershipCredential,
			providerAccessToken: starter.connection.providerAccessToken,
			providerSessionId: starter.connection.providerSessionId, providerSessionSequence: sequence,
			privateJwk: input.privateJwk, assignmentId: null, executionProviderId: 'acceptance-deterministic',
			capabilities: CAPABILITIES,
			activityProfile: { kind: 'engineering-workflow', subjectModel: 'objective', subjectSlug: OBJECTIVE_ID },
		});
		sequence = Number(execution.providerSessionSequence ?? sequence);
		const assignment = await input.adminClient.capacityProviderAssignment(starter.connection.teamId, execution.assignmentId);
		const terminal = await verifyCapacityAcceptanceTerminal({
			adminClient: input.adminClient, config: { teamId: starter.connection.teamId, projectId: starter.project.id },
			assignmentId: execution.assignmentId,
			expectedArtifactCount: expectedArtifacts ?? (assignment.payload.handlerId === 'estimate' ? 0 : 1),
		});
		agents.add(String(assignment.payload.agentId ?? ''));
		completedAssignments += 1;
		artifactCount += terminal.artifactCount;
		usageActualCount += terminal.usageActualCount;
		ledgerEntryCount += terminal.ledgerEntryCount;
		return assignment.payload;
	};
	try {
		for (const classSlug of ['engineering', 'release', 'reporting', 'research', 'review', 'technical-writing', 'testing']) {
			await setClassState(classSlug, { status: 'paused' }, 'proposal-profile');
		}
		await setClassState('architecture', { status: 'active', allowedModes: ['planning'] }, 'proposal-profile');
		await input.adminClient.createPlanningInputRequest(DECISION_ID, {
			id: `engineering-proposal:${input.runId}`, projectId: starter.project.id,
			projectAgentClassId: `${starter.project.id}:architecture`, mode: 'planning',
			prompt: 'Create the linked test-first release-channel proposal.',
			metadata: { agentId: 'architect', planningSource: 'engineering-live-proposal', priority: 100 },
		});
		await executeNext('proposal', 1);
		const engineeringClassId = `${starter.project.id}:engineering`;
		const engineeringClass = (await input.adminClient.projectAgentClass(starter.project.id, engineeringClassId)).payload;
		const handlerRefs = structuredClone(record(engineeringClass.handlerRefs));
		const classAgents = Array.isArray(handlerRefs.agents) ? handlerRefs.agents.map(record) : [];
		for (const agent of classAgents) {
			const activities = record(agent.activities);
			delete activities.planning;
			delete activities.reviewing;
			delete activities.reporting;
			agent.activities = activities;
		}
		handlerRefs.agents = classAgents;
		await setClassState('architecture', { status: 'paused' }, 'estimate-profile');
		const estimateProfile = await setClassState('engineering', { status: 'active', handlerRefs, allowedModes: ['planning', 'acting'] }, 'estimate-profile');
		const returnedRefs = record(record(estimateProfile.payload).handlerRefs);
		const returnedAgents = Array.isArray(returnedRefs.agents) ? returnedRefs.agents.map(record) : [];
		const estimateActivities = record(returnedAgents[0]?.activities);
		if (!estimateActivities.estimating || estimateActivities.planning || estimateActivities.reviewing) {
			throw new Error(`Engineering estimate profile did not become canonical: ${JSON.stringify(estimateProfile.payload)}`);
		}
		await input.adminClient.createPlanningInputRequest(DECISION_ID, {
			id: `engineering-estimate:${input.runId}`, projectId: starter.project.id,
			projectAgentClassId: `${starter.project.id}:engineering`, mode: 'planning',
			prompt: 'Estimate the accepted release-channel proposal.',
			metadata: { agentId: 'engineer', planningSource: 'engineering-live-estimate', priority: 100, activityType: 'estimating' },
		});
		let estimate: Record<string, unknown> | undefined;
		for (let index = 0; index < 12 && !estimate; index += 1) {
			await executeNext(`estimate-${index}`);
			const estimates = await input.adminClient.decisionStructuredEstimates(DECISION_ID, 'submitted');
			estimate = estimates.payload.find((entry) => entry.projectId === starter.project.id);
		}
		if (!estimate?.id || estimate.proposalId !== 'normalize-release-channel-inputs') {
			throw new Error(`Engineering starter did not produce its linked estimate: ${JSON.stringify(estimate)}`);
		}
		await input.adminClient.acceptStructuredAgentEstimate(String(estimate.id), { metadata: { liveAcceptance: true } });
		for (const classSlug of ['architecture', 'engineering', 'release', 'research', 'review', 'technical-writing', 'testing']) {
			await setClassState(classSlug, { status: 'active', allowedModes: ['acting'] }, 'acting-profile');
		}
		await setClassState('reporting', { status: 'paused', allowedModes: ['planning'] }, 'acting-profile');
		let graph: Record<string, unknown> | null = null;
		for (let index = 0; index < 20; index += 1) {
			const graphs = await input.adminClient.decisionAssignmentGraphs(DECISION_ID, { active: true });
			graph = graphs.payload.find((entry) => entry.projectId === starter.project.id) ?? null;
			if (graph?.status === 'completed') break;
			await executeNext(`graph-${index}`);
		}
		if (!graph || graph.status !== 'completed') throw new Error(`Engineering starter graph did not complete: ${JSON.stringify(graph)}`);
		const nodes = graphNodes(graph);
		const stages = new Set(nodes.map((node) => String(record(node.metadata).stage ?? '')));
		const revisionNodes = nodes.filter((node) => Number(record(node.metadata).revisionCycle ?? 0) > 0);
		for (const stage of ['research', 'architecture', 'test', 'implementation', 'verification', 'review', 'documentation', 'release']) {
			if (!stages.has(stage)) throw new Error(`Engineering starter graph omitted ${stage}.`);
		}
		if (revisionNodes.length !== 3 || !nodes.every((node) => node.status === 'completed')) throw new Error('Engineering starter graph omitted its complete three-node revision cycle.');
		const reportingClassId = `${starter.project.id}:reporting`;
		const reportingClass = (await input.adminClient.projectAgentClass(starter.project.id, reportingClassId)).payload;
		const reportingRefs = structuredClone(record(reportingClass.handlerRefs));
		const reportingAgents = Array.isArray(reportingRefs.agents) ? reportingRefs.agents.map(record) : [];
		for (const agent of reportingAgents) {
			const activities = record(agent.activities);
			for (const activityType of Object.keys(activities)) if (activityType !== 'reporting') delete activities[activityType];
			agent.activities = activities;
		}
		reportingRefs.agents = reportingAgents;
		await setClassState('reporting', { status: 'active', allowedModes: ['planning'], handlerRefs: reportingRefs }, 'reporting-profile');
		await input.adminClient.createPlanningInputRequest(DECISION_ID, {
			id: `engineering-report:${input.runId}`, projectId: starter.project.id,
			projectAgentClassId: `${starter.project.id}:reporting`, mode: 'planning', prompt: 'Produce the deterministic engineering workday summary.',
			metadata: { agentId: 'reporter', planningSource: 'engineering-live-report', priority: 100, activityType: 'reporting' },
		});
		let report: Record<string, unknown> | null = null;
		for (let index = 0; index < 12 && report?.agentId !== 'reporter'; index += 1) {
			report = await executeNext(`report-${index}`);
		}
		if (!agents.has('tester') || !agents.has('engineer') || !agents.has('reviewer') || !agents.has('technical-writer') || !agents.has('releaser') || report.agentId !== 'reporter') {
			throw new Error(`Engineering starter omitted required role execution: ${JSON.stringify([...agents])}`);
		}
		return {
			starter: 'engineering', projectId: starter.project.id, assignmentId: String(report.id),
			completedAssignments, artifactCount, usageActualCount, ledgerEntryCount,
			graphStatus: String(graph.status), graphNodeCount: nodes.length, revisionNodeCount: revisionNodes.length,
			exactBaseRef, participatingAgents: [...agents].filter(Boolean).sort(),
		};
	} finally {
		await starter.cleanup();
	}
}
