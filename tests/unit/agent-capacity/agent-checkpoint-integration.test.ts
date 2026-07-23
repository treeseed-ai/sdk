import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { integrateAgentCheckpoint } from '../../../src/operations/agent-checkpoint-integration.ts';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]) {
	return (await execFileAsync('git', args, { cwd })).stdout.trim();
}

describe('supervised agent checkpoint integration', () => {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	async function fixture() {
		const root = await mkdtemp(join(tmpdir(), 'treeseed-agent-integration-'));
		roots.push(root);
		const repositoryPath = join(root, 'packages', 'sdk');
		await mkdir(repositoryPath, { recursive: true });
		await git(repositoryPath, 'init', '-b', 'feature/supervised-agent');
		await git(repositoryPath, 'config', 'user.name', 'Treeseed Test');
		await git(repositoryPath, 'config', 'user.email', 'test@treeseed.local');
		await git(repositoryPath, 'remote', 'add', 'origin', 'https://github.com/treeseed-ai/sdk.git');
		await writeFile(join(repositoryPath, 'source.ts'), 'export const value = 1;\n');
		await git(repositoryPath, 'add', 'source.ts');
		await git(repositoryPath, 'commit', '-m', 'base');
		const baseCommit = await git(repositoryPath, 'rev-parse', 'HEAD');
		await git(repositoryPath, 'switch', '-c', 'assignment/checkpoint');
		await writeFile(join(repositoryPath, 'source.ts'), 'export const value = 2;\n');
		await git(repositoryPath, 'add', 'source.ts');
		await git(repositoryPath, 'commit', '-m', 'agent implementation');
		const checkpointCommit = await git(repositoryPath, 'rev-parse', 'HEAD');
		await git(repositoryPath, 'switch', 'feature/supervised-agent');
		const graphId = 'graph-1';
		const implementationContractId = 'contract-implementation';
		const nodes = [
			{ id: 'node-implementation', status: 'completed', metadata: { stage: 'implementation', producesDeliverableContractId: implementationContractId } },
			{ id: 'node-verification', status: 'completed', metadata: { stage: 'verification', producesDeliverableContractId: 'contract-verification' } },
			{ id: 'node-review', status: 'completed', metadata: { stage: 'review', producesDeliverableContractId: 'contract-review' } },
			{ id: 'node-release', status: 'completed', metadata: { stage: 'release', producesDeliverableContractId: 'contract-release' } },
		];
		const graph = {
			id: graphId, projectId: 'project-sdk', decisionId: 'decision-1', status: 'completed', nodes,
			deliverableContracts: [implementationContractId, 'contract-verification', 'contract-review', 'contract-release']
				.map((id) => ({ id, status: 'approved', metadata: id === implementationContractId ? { assignmentId: 'assignment-1', modeRunId: 'mode-run-1', deliverableManifestId: 'deliverable:assignment-1' } : {} })),
			metadata: { exactBaseRef: baseCommit },
		};
		const assignment = {
			id: 'assignment-1', projectId: 'project-sdk', status: 'completed', mode: 'acting',
			decisionInput: { input: { workGraphId: graphId, workGraphNodeId: 'node-implementation' } },
			workspaceContext: { project: { repository: { checkoutPath: 'packages/sdk', cloneUrl: 'https://github.com/treeseed-ai/sdk.git' } } },
			lifecycleOutput: { artifactManifest: {
				schemaVersion: 1, assignmentId: 'assignment-1', modeRunId: 'mode-run-1', teamId: 'team-1', projectId: 'project-sdk',
				providerId: 'provider-1', mode: 'acting', agentClassId: 'engineering', agentId: 'engineer', handlerId: 'actor',
				activityType: 'acting', status: 'completed', summary: 'Implemented the selected change.', toolEvents: [], contentReferences: [],
				sourceWorktree: { root: '.agent-worktrees/assignment-1', branch: 'assignment/checkpoint', baseRef: baseCommit, changedPaths: ['source.ts'] },
				commit: { sha: checkpointCommit }, verification: [{ status: 'passed', summary: 'Focused tests passed.' }], citations: [], signals: [], usage: [], diagnostics: [], createdAt: new Date().toISOString(),
			} },
		};
		const deliverableManifest = {
			id: 'deliverable:assignment-1', deliverableContractId: implementationContractId, projectId: 'project-sdk', decisionId: 'decision-1',
			sourceAuthority: { assignmentId: 'assignment-1', modeRunId: 'mode-run-1', baseRef: baseCommit, effectiveRef: checkpointCommit, checkpointCommit },
		};
		return { root, repositoryPath, baseCommit, checkpointCommit, graph, assignment, deliverableManifest, projectRepository: { checkoutPath: 'packages/sdk', url: 'https://github.com/treeseed-ai/sdk.git' } };
	}

	it('plans and explicitly integrates the latest reviewed checkpoint without publishing it', async () => {
		const input = await fixture();
		const planned = await integrateAgentCheckpoint({ workspaceRoot: input.root, assignment: input.assignment, graph: input.graph, projectRepository: input.projectRepository, deliverableManifest: input.deliverableManifest, mode: 'plan' });
		expect(planned).toMatchObject({ ok: true, baseCommit: input.baseCommit, checkpointCommit: input.checkpointCommit, changedPaths: ['source.ts'], nextOperation: null });

		const integrated = await integrateAgentCheckpoint({ workspaceRoot: input.root, assignment: input.assignment, graph: input.graph, projectRepository: input.projectRepository, deliverableManifest: input.deliverableManifest, mode: 'execute' });
		expect(integrated.ok).toBe(true);
		expect(integrated.integratedCommit).toBe(input.checkpointCommit);
		expect(integrated.nextOperation).toBe('treeseed save');
		expect(await git(input.repositoryPath, 'branch', '--show-current')).toBe('feature/supervised-agent');
		expect(await git(input.repositoryPath, 'status', '--porcelain')).toBe('');
		expect(await git(input.repositoryPath, 'rev-parse', 'HEAD^{tree}')).toBe(await git(input.repositoryPath, 'rev-parse', `${input.checkpointCommit}^{tree}`));
		const replay = await integrateAgentCheckpoint({ workspaceRoot: input.root, assignment: input.assignment, graph: input.graph, projectRepository: input.projectRepository, deliverableManifest: input.deliverableManifest, mode: 'execute' });
		expect(replay).toMatchObject({ ok: true, alreadyIntegrated: true, integratedCommit: integrated.integratedCommit });
	});

	it('fails closed when the task branch has diverged from the governed base', async () => {
		const input = await fixture();
		await writeFile(join(input.repositoryPath, 'unrelated.ts'), 'export {};\n');
		await git(input.repositoryPath, 'add', 'unrelated.ts');
		await git(input.repositoryPath, 'commit', '-m', 'unrelated task work');

		const result = await integrateAgentCheckpoint({ workspaceRoot: input.root, assignment: input.assignment, graph: input.graph, projectRepository: input.projectRepository, deliverableManifest: input.deliverableManifest, mode: 'plan' });
		expect(result.ok).toBe(false);
		expect(result.blockers).toContain('Task branch no longer equals the assignment graph exact base ref.');
	});

	it('rejects a checkpoint superseded by a later implementation revision', async () => {
		const input = await fixture();
		input.graph.nodes.push({
			id: 'node-implementation-revision', status: 'completed',
			metadata: { stage: 'implementation', revisionCycle: 1, producesDeliverableContractId: 'contract-implementation-revision' },
		});
		input.graph.deliverableContracts.push({ id: 'contract-implementation-revision', status: 'approved' });

		const result = await integrateAgentCheckpoint({ workspaceRoot: input.root, assignment: input.assignment, graph: input.graph, projectRepository: input.projectRepository, deliverableManifest: input.deliverableManifest, mode: 'plan' });
		expect(result.ok).toBe(false);
		expect(result.blockers).toContain('Assignment checkpoint was superseded by a later implementation revision.');
	});

	it('rejects checkpoint authority that is not the API-selected deliverable manifest', async () => {
		const input = await fixture();
		input.deliverableManifest.sourceAuthority.assignmentId = 'assignment-other';
		const result = await integrateAgentCheckpoint({ workspaceRoot: input.root, assignment: input.assignment, graph: input.graph, projectRepository: input.projectRepository, deliverableManifest: input.deliverableManifest, mode: 'plan' });
		expect(result.ok).toBe(false);
		expect(result.blockers).toContain('Approved implementation deliverable does not select this assignment checkpoint authority.');
	});

	it('rejects artifact changed-path evidence that differs from the immutable Git diff', async () => {
		const input = await fixture();
		input.assignment.lifecycleOutput.artifactManifest.sourceWorktree.changedPaths = ['different.ts'];
		const result = await integrateAgentCheckpoint({ workspaceRoot: input.root, assignment: input.assignment, graph: input.graph, projectRepository: input.projectRepository, deliverableManifest: input.deliverableManifest, mode: 'plan' });
		expect(result.ok).toBe(false);
		expect(result.blockers).toContain('Artifact manifest changed paths do not match the checkpoint Git diff.');
	});
});
