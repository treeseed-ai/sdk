import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { validateAgentArtifactManifest, type AgentArtifactManifest } from '../agent-capacity/artifacts.ts';
import type { DecisionAssignmentGraphRecord } from '../agent-capacity/contracts/decision-work.ts';

export const execFileAsync = promisify(execFile);
export const PROTECTED_BRANCHES = new Set(['main', 'master', 'staging', 'production']);

export type JsonRecord = Record<string, unknown>;

export interface AgentCheckpointIntegrationExecutor {
	exec(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr?: string }>;
}

export interface AgentCheckpointIntegrationInput {
	workspaceRoot: string;
	assignment: JsonRecord;
	graph: JsonRecord;
	projectRepository: JsonRecord;
	deliverableManifest: JsonRecord;
	mode: 'plan' | 'execute';
}

export interface AgentCheckpointIntegrationResult {
	ok: boolean;
	mode: 'plan' | 'execute';
	assignmentId: string;
	projectId: string;
	graphId: string;
	graphNodeId: string;
	repositoryPath: string;
	targetBranch: string | null;
	baseCommit: string;
	checkpointCommit: string;
	integratedCommit: string | null;
	alreadyIntegrated: boolean;
	commits: string[];
	changedPaths: string[];
	blockers: string[];
	nextOperation: 'treeseed save' | null;
}

export function record(value: unknown): JsonRecord {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

export function text(...values: unknown[]) {
	for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
	return '';
}

export function array(value: unknown) {
	return Array.isArray(value) ? value : [];
}

export function normalizedPath(value: string) {
	return value.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+/gu, '/');
}

export function isInside(root: string, candidate: string) {
	const path = relative(root, candidate);
	return path === '' || (!path.startsWith('..') && !path.startsWith('/'));
}

export function graphNodeStage(node: JsonRecord) {
	return text(record(node.metadata).stage);
}

export function revisionCycle(node: JsonRecord) {
	const value = Number(record(node.metadata).revisionCycle ?? 0);
	return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function manifestFromAssignment(assignment: JsonRecord) {
	const lifecycle = record(assignment.lifecycleOutput);
	const direct = record(lifecycle.artifactManifest);
	const nested = record(record(record(lifecycle.metadata).executionSnapshot).artifactManifest);
	return Object.keys(direct).length ? direct : nested;
}

export function immutableCommit(value: string) {
	return /^[0-9a-f]{40}$/iu.test(value);
}

export function normalizeRemote(value: string) {
	return value.trim().replace(/^git\+/u, '').replace(/\.git\/?$/u, '').replace(/\/$/u, '')
		.replace(/^git@([^:]+):/u, 'https://$1/').replace(/^ssh:\/\/git@([^/]+)\//u, 'https://$1/');
}

export async function inspectGit(executor: AgentCheckpointIntegrationExecutor, repositoryPath: string, args: string[]) {
	return (await executor.exec('git', args, { cwd: repositoryPath, env: process.env })).stdout.trim();
}

export async function integrateAgentCheckpoint(
	input: AgentCheckpointIntegrationInput,
	executor: AgentCheckpointIntegrationExecutor = { exec: execFileAsync },
): Promise<AgentCheckpointIntegrationResult> {
	const assignment = input.assignment;
	const graph = input.graph as unknown as DecisionAssignmentGraphRecord;
	const assignmentId = text(assignment.id);
	const projectId = text(assignment.projectId);
	const decisionInput = record(assignment.decisionInput);
	const selectedInput = record(decisionInput.input);
	const graphId = text(selectedInput.workGraphId, record(decisionInput.metadata).graphId);
	const graphNodeId = text(selectedInput.workGraphNodeId, decisionInput.workGraphNodeId, record(decisionInput.metadata).graphNodeId);
	const repository = record(input.projectRepository);
	const checkoutPath = text(repository.checkoutPath);
	const workspaceRoot = resolve(input.workspaceRoot);
	const repositoryPath = resolve(workspaceRoot, checkoutPath || '.');
	const manifestRecord = manifestFromAssignment(assignment);
	const manifest = manifestRecord as unknown as AgentArtifactManifest;
	const deliverableManifest = record(input.deliverableManifest);
	const checkpointCommit = text(record(manifestRecord.commit).sha);
	const baseCommit = text(record(graph.metadata).exactBaseRef);
	const blockers: string[] = [];

	if (!assignmentId) blockers.push('Assignment id is missing.');
	if (assignment.status !== 'completed' || assignment.mode !== 'acting') blockers.push('Only completed acting assignments can be integrated.');
	if (!projectId || graph.projectId !== projectId) blockers.push('Assignment and graph project scope do not match.');
	if (!graphId || graph.id !== graphId) blockers.push('Assignment does not identify the supplied decision graph.');
	if (graph.status !== 'completed') blockers.push('Decision graph is not completed.');
	if (!checkoutPath) blockers.push('Project repository topology checkoutPath is missing.');
	if (!isInside(workspaceRoot, repositoryPath)) blockers.push('Project repository resolves outside the operator workspace.');
	if (!immutableCommit(baseCommit)) blockers.push('Decision graph exact base ref is missing or mutable.');
	if (!immutableCommit(checkpointCommit)) blockers.push('Assignment artifact manifest has no immutable source checkpoint.');

	const nodes = array(graph.nodes).map(record);
	const contracts = array(graph.deliverableContracts).map(record);
	const selectedNode = nodes.find((node) => text(node.id) === graphNodeId);
	const implementationNodes = nodes.filter((node) => graphNodeStage(node) === 'implementation');
	const latestImplementation = implementationNodes.sort((left, right) => revisionCycle(right) - revisionCycle(left))[0];
	if (!selectedNode || graphNodeStage(selectedNode) !== 'implementation') blockers.push('Assignment is not an engineering implementation checkpoint.');
	if (latestImplementation && text(latestImplementation.id) !== graphNodeId) blockers.push('Assignment checkpoint was superseded by a later implementation revision.');
	if (selectedNode?.status !== 'completed') blockers.push('Selected implementation graph node is not completed.');
	const contractId = text(record(selectedNode?.metadata).producesDeliverableContractId);
	const contract = contracts.find((entry) => text(entry.id) === contractId);
	if (!contractId || contract?.status !== 'approved') blockers.push('Selected implementation deliverable is not approved.');
	const sourceAuthority = record(deliverableManifest.sourceAuthority);
	if (text(deliverableManifest.id) !== `deliverable:${assignmentId}` || text(deliverableManifest.deliverableContractId) !== contractId
		|| text(deliverableManifest.projectId) !== projectId || text(deliverableManifest.decisionId) !== text(graph.decisionId)
		|| text(sourceAuthority.assignmentId) !== assignmentId || text(sourceAuthority.modeRunId) !== text(manifestRecord.modeRunId)
		|| text(sourceAuthority.baseRef) !== baseCommit || text(sourceAuthority.effectiveRef) !== checkpointCommit
		|| text(sourceAuthority.checkpointCommit) !== checkpointCommit) {
		blockers.push('Approved implementation deliverable does not select this assignment checkpoint authority.');
	}
	const finalReview = nodes.filter((node) => graphNodeStage(node) === 'review').sort((left, right) => revisionCycle(right) - revisionCycle(left))[0];
	const finalReviewContractId = text(record(finalReview?.metadata).producesDeliverableContractId);
	const finalReviewContract = contracts.find((entry) => text(entry.id) === finalReviewContractId);
	if (!finalReview || finalReview.status !== 'completed' || finalReviewContract?.status !== 'approved') blockers.push('Final independent review is not approved.');
	const finalVerification = nodes.filter((node) => graphNodeStage(node) === 'verification').sort((left, right) => revisionCycle(right) - revisionCycle(left))[0];
	if (!finalVerification || finalVerification.status !== 'completed') blockers.push('Final verification stage is not completed.');
	const releaseNode = nodes.find((node) => graphNodeStage(node) === 'release');
	if (!releaseNode || releaseNode.status !== 'completed') blockers.push('Release-readiness stage is not completed.');

	try {
		const validation = validateAgentArtifactManifest(manifest);
		if (!validation.ok || manifest.assignmentId !== assignmentId || manifest.projectId !== projectId || manifest.mode !== 'acting' || manifest.status !== 'completed') {
			blockers.push(validation.ok ? 'Artifact manifest scope does not match the assignment.' : `Artifact manifest is invalid: ${validation.reason}`);
		}
		if (manifest.verification.some((entry) => entry.status === 'failed')) blockers.push('Assignment artifact manifest contains failed verification evidence.');
		if (text(record(manifestRecord.sourceWorktree).baseRef) !== baseCommit) blockers.push('Artifact manifest source base does not match the decision graph exact base ref.');
	} catch (error) {
		blockers.push(`Artifact manifest is malformed: ${error instanceof Error ? error.message : String(error)}`);
	}

	let targetBranch: string | null = null;
	let commits: string[] = [];
	let changedPaths: string[] = [];
	let integratedCommit: string | null = null;
	let alreadyIntegrated = false;
	try {
		const [realWorkspaceRoot, realRepositoryPath] = await Promise.all([realpath(workspaceRoot), realpath(repositoryPath)]);
		if (!isInside(realWorkspaceRoot, realRepositoryPath)) blockers.push('Project repository symlink resolves outside the operator workspace.');
		const observedRoot = await realpath(resolve(await inspectGit(executor, repositoryPath, ['rev-parse', '--show-toplevel'])));
		if (observedRoot !== realRepositoryPath) blockers.push('Project checkoutPath is not the root of the selected Git repository.');
		targetBranch = await inspectGit(executor, repositoryPath, ['branch', '--show-current']);
		if (!targetBranch || PROTECTED_BRANCHES.has(targetBranch)) blockers.push('Checkpoint integration requires an unprotected task branch.');
		const status = await inspectGit(executor, repositoryPath, ['status', '--porcelain', '--untracked-files=all']);
		if (status) blockers.push('Target repository is dirty.');
		const currentHead = await inspectGit(executor, repositoryPath, ['rev-parse', 'HEAD']);
		if (baseCommit && checkpointCommit) {
			await inspectGit(executor, repositoryPath, ['merge-base', '--is-ancestor', baseCommit, checkpointCommit]);
			commits = (await inspectGit(executor, repositoryPath, ['rev-list', '--reverse', '--topo-order', `${baseCommit}..${checkpointCommit}`])).split('\n').filter(Boolean);
			changedPaths = (await inspectGit(executor, repositoryPath, ['diff', '--name-only', baseCommit, checkpointCommit])).split('\n').map(normalizedPath).filter(Boolean);
			if (!commits.length || !changedPaths.length) blockers.push('Checkpoint contains no source changes relative to the governed base ref.');
			const recordedPaths = array(record(manifestRecord.sourceWorktree).changedPaths).map(String).map(normalizedPath).filter(Boolean).sort();
			if (JSON.stringify(recordedPaths) !== JSON.stringify([...changedPaths].sort())) blockers.push('Artifact manifest changed paths do not match the checkpoint Git diff.');
			if (currentHead !== baseCommit) {
				const [currentTree, checkpointTree] = await Promise.all([
					inspectGit(executor, repositoryPath, ['rev-parse', `${currentHead}^{tree}`]),
					inspectGit(executor, repositoryPath, ['rev-parse', `${checkpointCommit}^{tree}`]),
				]);
				alreadyIntegrated = currentTree === checkpointTree;
				if (alreadyIntegrated) integratedCommit = currentHead;
				else blockers.push('Task branch no longer equals the assignment graph exact base ref.');
			}
		}
		const repositoryOwner = text(repository.owner);
		const repositoryName = text(repository.name);
		const expectedRemote = text(repository.url, repository.cloneUrl, repository.webUrl)
			|| (repositoryOwner && repositoryName ? `https://github.com/${repositoryOwner}/${repositoryName}` : '');
		const observedRemote = await inspectGit(executor, repositoryPath, ['config', '--get', 'remote.origin.url']);
		if (!expectedRemote || normalizeRemote(expectedRemote) !== normalizeRemote(observedRemote)) blockers.push('Local repository origin does not match the assignment project repository.');
	} catch (error) {
		blockers.push(`Git checkpoint inspection failed: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (input.mode === 'execute' && blockers.length === 0 && !alreadyIntegrated) {
		await executor.exec('git', ['merge', '--ff-only', checkpointCommit], { cwd: repositoryPath, env: process.env });
		integratedCommit = await inspectGit(executor, repositoryPath, ['rev-parse', 'HEAD']);
		const [integratedTree, checkpointTree] = await Promise.all([
			inspectGit(executor, repositoryPath, ['rev-parse', `${integratedCommit}^{tree}`]),
			inspectGit(executor, repositoryPath, ['rev-parse', `${checkpointCommit}^{tree}`]),
		]);
		if (integratedCommit !== checkpointCommit || integratedTree !== checkpointTree) {
			throw new Error('Fast-forwarded task branch does not match the selected assignment checkpoint.');
		}
	}

	return {
		ok: blockers.length === 0,
		mode: input.mode,
		assignmentId,
		projectId,
		graphId,
		graphNodeId,
		repositoryPath,
		targetBranch,
		baseCommit,
		checkpointCommit,
		integratedCommit,
		alreadyIntegrated,
		commits,
		changedPaths,
		blockers,
		nextOperation: blockers.length === 0 && input.mode === 'execute' ? 'treeseed save' : null,
	};
}
