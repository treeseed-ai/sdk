import { MarketClient } from '../market-client.ts';
import type { CapacityGovernanceRuntimeConnection } from './live-acceptance-capacity-governance.ts';
import type { CapacityAcceptanceProof } from './live-acceptance-capacity-context.ts';
import type { RunTreeseedLiveReconcileTestsOptions } from './live-acceptance.ts';
import type { TreeseedCapacityAcceptanceExecutionInput } from './live-acceptance-capacity-executor.ts';
import { verifyCapacityAcceptanceTerminal } from './live-acceptance-capacity-terminal.ts';
import { provisionLocalStarterCapacity } from './live-acceptance-starter-runtime.ts';

const RESEARCH_AGENT_PATHS = ['researcher', 'reviewer', 'technical-writer', 'reporter']
	.map((slug) => `template/src/content/agents/${slug}.mdx`);
const CAPABILITIES = ['planning', 'repo_read', 'agent_mode_run', 'usage_report', 'research', 'review', 'technical-writing', 'reporting'];

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function provisionLocalResearchStarterPlanning(input: {
	adminClient: MarketClient;
	apiUrl: string;
	runId: string;
	runtime: CapacityGovernanceRuntimeConnection;
	privateJwk: TreeseedCapacityAcceptanceExecutionInput['privateJwk'];
	fetchImpl: typeof fetch;
}) {
	const key = `research-starter:${input.runId}`;
	const starter = await provisionLocalStarterCapacity({
		...input,
		config: {
			starter: 'research', repositoryName: 'treeseed-starter-research', agentPaths: RESEARCH_AGENT_PATHS,
			capabilities: CAPABILITIES, allowedModes: ['planning'], credits: 64, durationSeconds: 3_600,
			parameters: { planningOnly: true, metadata: { liveAcceptance: true, starter: 'research' } },
			projectMetadata: {
				architecture: { topology: 'single_repository_site', rootPath: 'template', sitePath: 'template', contentPath: 'template/src/content', contentRuntimeSource: 'treedx_snapshot', localContentMaterialization: 'existing_path' },
				repository: { provider: 'git', owner: 'treeseed-templates', name: 'research', defaultBranch: 'main', checkoutPath: 'starters/research', cloneUrl: 'https://github.com/treeseed-templates/research.git' },
				agentSpecs: { root: 'template/src/content/agents', testsRoot: 'template/src/content/agent-tests' },
			},
		},
	});
	try {
		const workflowId = `${key}:workflow`;
		await input.adminClient.createResearchWorkflow(starter.project.id, {
			id: workflowId, objectiveRef: 'objective:publish-the-first-knowledge-pack',
			questionRef: 'question:what-should-this-research-map-first', minimumIndependentSources: 2,
			idempotencyKey: `${key}:workflow-create`, metadata: { liveAcceptance: true, runId: input.runId },
		});
		await input.adminClient.tickWorkdayRun(input.runtime.teamId, starter.workdayRunId, { idempotencyKey: `${key}:tick` });
		return {
			project: starter.project, workflowId,
			runId: starter.workdayRunId,
			connection: starter.connection,
			cleanup: starter.cleanup,
		};
	} catch (error) {
		await starter.cleanup().catch((cleanupError) => { throw new AggregateError([error, cleanupError], 'Research starter provisioning and cleanup both failed.'); });
		throw error;
	}
}

export async function runLocalResearchStarterPlanningAcceptance(input: {
	adminClient: MarketClient;
	apiUrl: string;
	runId: string;
	runtime: CapacityGovernanceRuntimeConnection;
	fetchImpl: typeof fetch;
	privateJwk: TreeseedCapacityAcceptanceExecutionInput['privateJwk'];
	executor: NonNullable<RunTreeseedLiveReconcileTestsOptions['capacityAssignmentExecutor']>;
}): Promise<NonNullable<CapacityAcceptanceProof['starterPlanning']>> {
	const starter = await provisionLocalResearchStarterPlanning(input);
	try {
		let sequence = starter.connection.providerSessionSequence;
		let assignmentId = '';
		let artifactCount = 0;
		let usageActualCount = 0;
		let ledgerEntryCount = 0;
		let completedAssignments = 0;
		let workflow = (await input.adminClient.researchWorkflow(starter.workflowId)).payload;
		for (let index = 0; index < 64 && workflow.status !== 'completed'; index += 1) {
			await input.adminClient.tickWorkdayRun(starter.connection.teamId, starter.runId, {
				idempotencyKey: `research-starter:${input.runId}:tick:${index}`,
			});
			const execution = await input.executor({
				runId: `${input.runId}-research-${index}`, apiUrl: input.apiUrl,
				teamId: starter.connection.teamId, projectId: starter.project.id,
				providerId: starter.connection.providerId, membershipId: starter.connection.membershipId,
				credentialId: starter.connection.credentialId, membershipCredential: starter.connection.membershipCredential,
				providerAccessToken: starter.connection.providerAccessToken,
				providerSessionId: starter.connection.providerSessionId, providerSessionSequence: sequence,
				privateJwk: input.privateJwk, assignmentId: null, executionProviderId: 'acceptance-deterministic',
				capabilities: CAPABILITIES,
				activityProfile: { kind: 'research-workflow', subjectModel: 'question', subjectSlug: 'what-should-this-research-map-first' },
			});
			sequence = Number((execution as { providerSessionSequence?: number }).providerSessionSequence ?? sequence);
			assignmentId = execution.assignmentId;
			const completedAssignment = await input.adminClient.capacityProviderAssignment(starter.connection.teamId, assignmentId);
			const researchStage = String(record(record(completedAssignment.payload.decisionInput).input).researchStage ?? '');
			const terminal = await verifyCapacityAcceptanceTerminal({
				adminClient: input.adminClient,
				config: { teamId: starter.connection.teamId, projectId: starter.project.id },
				assignmentId,
				expectedArtifactCount: researchStage === 'linked-evidence-notes' ? 2 : 1,
			});
			artifactCount += terminal.artifactCount;
			usageActualCount += terminal.usageActualCount;
			ledgerEntryCount += terminal.ledgerEntryCount;
			completedAssignments += 1;
			workflow = (await input.adminClient.researchWorkflow(starter.workflowId)).payload;
		}
		if (workflow.status !== 'completed' || workflow.reviewerRejectedUnsupportedClaims !== true || workflow.reviewerApprovedRevision !== true) {
			throw new Error(`Research starter workflow did not complete its rejection/revision/approval graph: ${JSON.stringify(workflow)}`);
		}
		if (!Array.isArray(workflow.citations) || workflow.citations.length < 2 || Number(workflow.revisionCount) < 1) {
			throw new Error('Research starter workflow omitted independent citations or its required revision.');
		}
		const assignment = await input.adminClient.capacityProviderAssignment(starter.connection.teamId, assignmentId);
		const proof = {
			starter: 'research' as const, projectId: starter.project.id, assignmentId,
			agentId: String(assignment.payload.agentId ?? ''), handlerId: String(assignment.payload.handlerId ?? ''),
			artifactCount, usageActualCount, ledgerEntryCount, completedAssignments,
			workflowStatus: String(workflow.status), citationCount: workflow.citations.length, revisionCount: Number(workflow.revisionCount),
		};
		if (!proof.agentId || !proof.handlerId) throw new Error('Research starter planning assignment omitted its content-defined agent or handler identity.');
		return proof;
	} finally {
		await starter.cleanup();
	}
}
