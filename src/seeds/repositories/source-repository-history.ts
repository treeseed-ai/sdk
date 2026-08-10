import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { credentialEnvironment, git, migrationBranches, migrationCredential, remoteHead, resolveRef } from './repository-history.js';
import type { SeedManifest } from '../types.js';

type SourceHistoryReceipt = { branch: string; sourceCommit: string; targetCommit: string; workflow: string | null; verified: boolean };

export type SourceRepositoryHistoryPlan = {
	project: string;
	sourcePath: string;
	targetRepository: string;
	workflow: string | null;
	branches: Array<{ branch: string; sourceRef: string; sourceCommit: string | null; targetCommit: string | null; workflowPresent: boolean; action: 'create' | 'update' | 'noop' | 'blocked'; reason: string }>;
};

function journalPath(projectRoot: string, repository: string) {
	return resolve(projectRoot, '.treeseed', 'repository-migrations', `${repository.replace('/', '--')}--source.json`);
}

function journal(projectRoot: string, repository: string) {
	try {
		return JSON.parse(readFileSync(journalPath(projectRoot, repository), 'utf8')) as { receipts?: SourceHistoryReceipt[] };
	} catch {
		return null;
	}
}

function writeJournal(projectRoot: string, plan: SourceRepositoryHistoryPlan, receipts: SourceHistoryReceipt[], status: 'partial' | 'history_verified') {
	const path = journalPath(projectRoot, plan.targetRepository);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, kind: 'treeseed.repository-source-history-migration', project: plan.project, targetRepository: plan.targetRepository, status, updatedAt: new Date().toISOString(), receipts }, null, 2)}\n`, 'utf8');
}

export function classifySourceHistoryBranch(input: { sourceCommit: string | null; targetCommit: string | null; workflow?: string | null; receipt?: Partial<SourceHistoryReceipt> | null }) {
	if (!input.sourceCommit) return { action: 'blocked' as const, reason: 'Source branch is missing.' };
	if (input.targetCommit && input.receipt?.verified === true && input.receipt.sourceCommit === input.sourceCommit && input.receipt.targetCommit === input.targetCommit && (input.receipt.workflow ?? null) === (input.workflow ?? null)) {
		return { action: 'noop' as const, reason: 'Live source and target commits match the verified migration receipt.' };
	}
	if (input.targetCommit === input.sourceCommit && input.receipt?.verified === true && input.receipt.targetCommit === input.sourceCommit && !(input.receipt.workflow) && input.workflow) {
		return { action: 'update' as const, reason: `Add required workflow .github/workflows/${input.workflow} as a fast-forward migration commit.` };
	}
	if (input.targetCommit) return { action: 'blocked' as const, reason: 'Target branch differs from the verified migration journal or has no receipt.' };
	return { action: 'create' as const, reason: 'Push the exact source history ref into the empty target branch.' };
}

function mappings(manifest: SeedManifest, projectRoot: string, selectedProject: string) {
	const project = manifest.resources.projects.find((entry) => entry.slug === selectedProject);
	if (!project) throw new Error(`Seed ${manifest.name} does not declare project ${selectedProject}.`);
	const migrationSourcePath = typeof project.metadata?.migrationSourcePath === 'string' ? project.metadata.migrationSourcePath.trim() : '';
	if (!migrationSourcePath) throw new Error(`Project ${selectedProject} does not declare metadata.migrationSourcePath; source history migration is not authorized.`);
	const workflows = project.repository.repositoryPolicy?.workflows ?? [];
	if (workflows.length > 1) throw new Error(`Project ${selectedProject} source migration currently requires at most one workflow.`);
	return { project, sourcePath: resolve(projectRoot, migrationSourcePath), targetRepository: `${project.repository.owner}/${project.repository.name}`, workflow: workflows[0] ?? null };
}

function verificationWorkflow() {
	return `name: Verify\n\non:\n  pull_request:\n  push:\n    branches: [main, staging]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n      - name: Verify generated project\n        working-directory: template\n        run: npm install --ignore-scripts && npm run verify\n`;
}

async function sourceTargetCommit(sourcePath: string, sourceCommit: string, workflow: string | null, workflowPresent: boolean, project: string, branch: string) {
	if (!workflow || workflowPresent) return sourceCommit;
	if (workflow !== 'verify.yml') throw new Error(`Source migration does not have a generator for ${workflow}.`);
	const temporary = mkdtempSync(resolve(tmpdir(), 'trsd-source-migration-'));
	const indexPath = resolve(temporary, 'index');
	const env = { ...process.env, GIT_INDEX_FILE: indexPath };
	try {
		await git(sourcePath, ['read-tree', sourceCommit], { env });
		const blob = (await git(sourcePath, ['hash-object', '-w', '--stdin'], { input: verificationWorkflow() })).stdout;
		await git(sourcePath, ['update-index', '--add', '--cacheinfo', '100644', blob, `.github/workflows/${workflow}`], { env });
		const tree = (await git(sourcePath, ['write-tree'], { env })).stdout;
		return (await git(sourcePath, ['commit-tree', tree, '-p', sourceCommit, '-m', `Prepare ${project} ${branch} repository workflow`], { env: { ...process.env, GIT_AUTHOR_NAME: 'TreeSeed migration', GIT_AUTHOR_EMAIL: 'operations@treeseed.dev', GIT_COMMITTER_NAME: 'TreeSeed migration', GIT_COMMITTER_EMAIL: 'operations@treeseed.dev' } })).stdout;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

export async function planSeedSourceRepositoryHistory(input: { projectRoot: string; manifest: SeedManifest; project: string; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const mapping = mappings(input.manifest, input.projectRoot, input.project);
	const credential = migrationCredential(input.projectRoot, mapping.targetRepository, input.env);
	if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${mapping.targetRepository}.`);
	const gitEnv = credentialEnvironment(credential.token);
	const recorded = journal(input.projectRoot, mapping.targetRepository);
	const branches: SourceRepositoryHistoryPlan['branches'] = [];
	for (const branch of await migrationBranches(mapping.sourcePath)) {
		const source = await resolveRef(mapping.sourcePath, branch);
		const targetCommit = await remoteHead(mapping.sourcePath, mapping.targetRepository, branch, gitEnv);
		const workflowPresent = Boolean(source && mapping.workflow && (await git(mapping.sourcePath, ['cat-file', '-e', `${source.ref}:.github/workflows/${mapping.workflow}`], { allowFailure: true })).code === 0);
		const receipt = recorded?.receipts?.find((entry) => entry.branch === branch);
		const classification = classifySourceHistoryBranch({ sourceCommit: source?.commit ?? null, targetCommit, workflow: mapping.workflow, receipt });
		branches.push({ branch, sourceRef: source?.ref ?? branch, sourceCommit: source?.commit ?? null, targetCommit, workflowPresent, ...classification });
	}
	return { project: mapping.project.slug, sourcePath: mapping.sourcePath, targetRepository: mapping.targetRepository, workflow: mapping.workflow, branches } satisfies SourceRepositoryHistoryPlan;
}

export async function applySeedSourceRepositoryHistory(input: { projectRoot: string; manifest: SeedManifest; project: string; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const plan = await planSeedSourceRepositoryHistory(input);
	if (plan.branches.some((branch) => branch.action === 'blocked')) throw new Error(plan.branches.filter((branch) => branch.action === 'blocked').map((branch) => branch.reason).join(' '));
	const credential = migrationCredential(input.projectRoot, plan.targetRepository, input.env);
	const gitEnv = credentialEnvironment(credential.token!);
	const receipts: SourceHistoryReceipt[] = [];
	for (const branch of plan.branches) {
		if (!branch.sourceCommit) throw new Error(`Source commit is missing for ${plan.project}@${branch.branch}.`);
		let expectedTarget = branch.targetCommit;
		if (branch.action === 'create' || branch.action === 'update') {
			expectedTarget = await sourceTargetCommit(plan.sourcePath, branch.sourceCommit, plan.workflow, branch.workflowPresent, plan.project, branch.branch);
			await git(plan.sourcePath, ['push', `https://github.com/${plan.targetRepository}.git`, `${expectedTarget}:refs/heads/${branch.branch}`], { env: gitEnv });
		}
		const observed = await remoteHead(plan.sourcePath, plan.targetRepository, branch.branch, gitEnv);
		if (!expectedTarget || observed !== expectedTarget) throw new Error(`Fresh GitHub read-back for ${plan.targetRepository}@${branch.branch} returned ${observed ?? 'missing'}, expected ${expectedTarget ?? 'missing'}.`);
		receipts.push({ branch: branch.branch, sourceCommit: branch.sourceCommit, targetCommit: observed, workflow: plan.workflow, verified: true });
		writeJournal(input.projectRoot, plan, receipts, receipts.length === plan.branches.length ? 'history_verified' : 'partial');
	}
	return { ...plan, status: 'history_verified' as const, receipts, journalPath: journalPath(input.projectRoot, plan.targetRepository) };
}
