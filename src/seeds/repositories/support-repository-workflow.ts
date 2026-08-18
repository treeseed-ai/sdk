import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { credentialEnvironment, git, migrationCredential, remoteHead } from './repository-history.js';
import type { SeedManifest } from '../types.js';

type Receipt = { branch: string; sourceCommit: string; targetCommit: string; workflowDigest: string; verified: boolean };

export type SupportWorkflowPlan = {
	repository: string;
	workflow: string;
	workflowDigest: string;
	branches: Array<{ branch: 'main' | 'staging'; sourceCommit: string; workflowPresent: boolean; action: 'update' | 'noop' | 'blocked'; reason: string }>;
};

function fixtureWorkflow() {
	return `name: Verify\n\non:\n  pull_request:\n  push:\n    branches: [main, staging]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  fixture-contract:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n      - name: Validate fixture contract\n        run: |\n          test -f sites/working-site/fixture.manifest.json\n          test -f sites/working-site/src/manifest.yaml\n          test -f sites/working-site/src/config.yaml\n          node -e \"const f=require('./sites/working-site/fixture.manifest.json'); if(f.id!=='treeseed-working-site'||f.contentRoot!=='src/content') process.exit(1)\"\n          test -z \"$(find . -type d \\( -name node_modules -o -name dist -o -name .astro \\) -print -quit)\"\n`;
}

function journalPath(projectRoot: string, repository: string) {
	return resolve(projectRoot, '.treeseed', 'repository-migrations', `${repository.replace('/', '--')}--support-workflow.json`);
}

function journal(projectRoot: string, repository: string) {
	try {
		return JSON.parse(readFileSync(journalPath(projectRoot, repository), 'utf8')) as { receipts?: Receipt[] };
	} catch {
		return null;
	}
}

function writeJournal(projectRoot: string, plan: SupportWorkflowPlan, receipts: Receipt[], status: 'partial' | 'verified') {
	const path = journalPath(projectRoot, plan.repository);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, kind: 'treeseed.support-repository-workflow', repository: plan.repository, workflow: plan.workflow, status, updatedAt: new Date().toISOString(), receipts }, null, 2)}\n`, 'utf8');
}

function supportRepository(manifest: SeedManifest, name: string) {
	const repository = manifest.resources.supportRepositories.find((entry) => entry.name === name);
	if (!repository) throw new Error(`Seed ${manifest.name} does not declare support repository ${name}.`);
	const workflows = repository.repositoryPolicy?.workflows ?? [];
	if (workflows.length !== 1 || workflows[0] !== 'verify.yml') throw new Error(`Support repository ${name} must declare exactly the supported verify.yml workflow.`);
	return repository;
}

async function withFetchedBranch<T>(input: { projectRoot: string; repository: string; branch: string; gitEnv: NodeJS.ProcessEnv }, operation: (repositoryRoot: string, commit: string) => Promise<T>) {
	const temporary = mkdtempSync(resolve(tmpdir(), 'trsd-support-workflow-'));
	try {
		await git(temporary, ['init', '--quiet']);
		await git(temporary, ['fetch', '--quiet', '--no-tags', `https://github.com/${input.repository}.git`, `refs/heads/${input.branch}`], { env: input.gitEnv });
		const commit = (await git(temporary, ['rev-parse', 'FETCH_HEAD'])).stdout;
		return await operation(temporary, commit);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

export function classifySupportWorkflow(input: { workflowPresent: boolean; sourceCommit: string; workflowDigest: string; receipt?: Partial<Receipt> | null }) {
	if (input.workflowPresent) return { action: 'noop' as const, reason: 'Required workflow exists on the live branch.' };
	if (input.receipt?.verified && input.receipt.targetCommit === input.sourceCommit) return { action: 'blocked' as const, reason: 'A verified workflow commit lost its required workflow.' };
	return { action: 'update' as const, reason: 'Add the required fixture verification workflow as a fast-forward commit.' };
}

export async function planSupportRepositoryWorkflow(input: { projectRoot: string; manifest: SeedManifest; repository: string; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const support = supportRepository(input.manifest, input.repository);
	const repository = `${support.owner}/${support.name}`;
	const credential = migrationCredential(input.projectRoot, repository, input.env);
	if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${repository}.`);
	const gitEnv = credentialEnvironment(credential.token);
	const workflow = fixtureWorkflow();
	const workflowDigest = createHash('sha256').update(workflow).digest('hex');
	const recorded = journal(input.projectRoot, repository);
	const branches: SupportWorkflowPlan['branches'] = [];
	for (const branch of ['main', 'staging'] as const) {
		const sourceCommit = await remoteHead(input.projectRoot, repository, branch, gitEnv);
		if (!sourceCommit) throw new Error(`Support repository ${repository} is missing ${branch}.`);
		const workflowPresent = await withFetchedBranch({ projectRoot: input.projectRoot, repository, branch, gitEnv }, async (root, commit) => (await git(root, ['cat-file', '-e', `${commit}:.github/workflows/verify.yml`], { allowFailure: true })).code === 0);
		const receipt = recorded?.receipts?.find((entry) => entry.branch === branch);
		branches.push({ branch, sourceCommit, workflowPresent, ...classifySupportWorkflow({ workflowPresent, sourceCommit, workflowDigest, receipt }) });
	}
	return { repository, workflow: 'verify.yml', workflowDigest, branches } satisfies SupportWorkflowPlan;
}

async function createWorkflowCommit(input: { projectRoot: string; repository: string; branch: string; sourceCommit: string; workflow: string; gitEnv: NodeJS.ProcessEnv }) {
	return withFetchedBranch({ projectRoot: input.projectRoot, repository: input.repository, branch: input.branch, gitEnv: input.gitEnv }, async (root, fetchedCommit) => {
		if (fetchedCommit !== input.sourceCommit) throw new Error(`Stale support workflow plan for ${input.repository}@${input.branch}.`);
		const indexPath = resolve(root, 'migration-index');
		const indexEnv = { ...process.env, GIT_INDEX_FILE: indexPath };
		await git(root, ['read-tree', fetchedCommit], { env: indexEnv });
		const blob = (await git(root, ['hash-object', '-w', '--stdin'], { input: input.workflow })).stdout;
		await git(root, ['update-index', '--add', '--cacheinfo', '100644', blob, '.github/workflows/verify.yml'], { env: indexEnv });
		const tree = (await git(root, ['write-tree'], { env: indexEnv })).stdout;
		const commit = (await git(root, ['commit-tree', tree, '-p', fetchedCommit, '-m', `Add ${input.repository} fixture verification`], { env: { ...process.env, GIT_AUTHOR_NAME: 'TreeSeed migration', GIT_AUTHOR_EMAIL: 'operations@treeseed.dev', GIT_COMMITTER_NAME: 'TreeSeed migration', GIT_COMMITTER_EMAIL: 'operations@treeseed.dev' } })).stdout;
		await git(root, ['push', `https://github.com/${input.repository}.git`, `${commit}:refs/heads/${input.branch}`], { env: input.gitEnv });
		return commit;
	});
}

export async function applySupportRepositoryWorkflow(input: { projectRoot: string; manifest: SeedManifest; repository: string; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const plan = await planSupportRepositoryWorkflow(input);
	if (plan.branches.some((branch) => branch.action === 'blocked')) throw new Error(plan.branches.filter((branch) => branch.action === 'blocked').map((branch) => branch.reason).join(' '));
	const credential = migrationCredential(input.projectRoot, plan.repository, input.env);
	const gitEnv = credentialEnvironment(credential.token!);
	const workflow = fixtureWorkflow();
	const receipts: Receipt[] = [];
	for (const branch of plan.branches) {
		const targetCommit = branch.action === 'update' ? await createWorkflowCommit({ projectRoot: input.projectRoot, repository: plan.repository, branch: branch.branch, sourceCommit: branch.sourceCommit, workflow, gitEnv }) : branch.sourceCommit;
		const observed = await remoteHead(input.projectRoot, plan.repository, branch.branch, gitEnv);
		if (observed !== targetCommit) throw new Error(`Fresh GitHub read-back for ${plan.repository}@${branch.branch} returned ${observed ?? 'missing'}, expected ${targetCommit}.`);
		receipts.push({ branch: branch.branch, sourceCommit: branch.sourceCommit, targetCommit, workflowDigest: plan.workflowDigest, verified: true });
		writeJournal(input.projectRoot, plan, receipts, receipts.length === plan.branches.length ? 'verified' : 'partial');
	}
	return { ...plan, status: 'verified' as const, receipts, journalPath: journalPath(input.projectRoot, plan.repository) };
}
