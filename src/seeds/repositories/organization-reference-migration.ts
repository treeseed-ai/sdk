import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { credentialEnvironment, git, migrationCredential, remoteHead } from './repository-history.js';
import { loadMachineConfig, writeMachineConfig } from '../../operations/services/config-runtime/support/rotate-machine-key-passphrase.js';
import type { SeedManifest } from '../types.js';

type Branch = 'main' | 'staging';
type BranchPlan = { repository: string; branch: Branch; sourceCommit: string | null; files: string[]; action: 'update' | 'noop' };

function repositories(manifest: SeedManifest) {
	return [...new Set([
		...manifest.resources.projects.map((project) => `${project.repository.owner}/${project.repository.name}`),
		...manifest.resources.hubRepositories.map((repository) => `${repository.owner}/${repository.name}`),
		...manifest.resources.supportRepositories.map((repository) => `${repository.owner}/${repository.name}`),
	])].sort();
}

async function withFetched<T>(repository: string, branch: Branch, gitEnv: NodeJS.ProcessEnv, operation: (root: string, commit: string | null) => Promise<T>) {
	const temporary = mkdtempSync(resolve(tmpdir(), 'trsd-organization-reference-'));
	try {
		await git(temporary, ['init', '--quiet']);
		const fetched = await git(temporary, ['fetch', '--quiet', '--no-tags', `https://github.com/${repository}.git`, `refs/heads/${branch}`], { env: gitEnv, allowFailure: true });
		return await operation(temporary, fetched.code === 0 ? (await git(temporary, ['rev-parse', 'FETCH_HEAD'])).stdout : null);
	} finally { rmSync(temporary, { recursive: true, force: true }); }
}

async function matchingFiles(root: string, commit: string) {
	const result = await git(root, ['grep', '-Il', '-e', 'knowledge-coop', commit, '--'], { allowFailure: true });
	if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr || 'Unable to scan repository references.');
	return result.stdout.split('\n').map((entry) => entry.trim()).filter(Boolean).map((entry) => entry.replace(`${commit}:`, '')).sort();
}

export async function planOrganizationReferenceMigration(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const credential = migrationCredential(input.projectRoot, 'treeseed-ai/platform', input.env);
	if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required.`);
	const gitEnv = credentialEnvironment(credential.token);
	const plans: BranchPlan[] = [];
	for (const repository of repositories(input.manifest)) {
		for (const branch of ['main', 'staging'] as const) {
			plans.push(await withFetched(repository, branch, gitEnv, async (root, sourceCommit) => {
				const files = sourceCommit ? await matchingFiles(root, sourceCommit) : [];
				return { repository, branch, sourceCommit, files, action: files.length ? 'update' : 'noop' };
			}));
		}
	}
	return { owner: 'treeseed-ai', plans };
}

async function applyBranch(projectRoot: string, plan: BranchPlan, gitEnv: NodeJS.ProcessEnv) {
	if (plan.action === 'noop' || !plan.sourceCommit) return plan.sourceCommit;
	return withFetched(plan.repository, plan.branch, gitEnv, async (root, fetchedCommit) => {
		if (fetchedCommit !== plan.sourceCommit) throw new Error(`Stale organization-reference plan for ${plan.repository}@${plan.branch}.`);
		const indexPath = resolve(root, 'migration-index');
		const indexEnv = { ...process.env, GIT_INDEX_FILE: indexPath };
		await git(root, ['read-tree', fetchedCommit], { env: indexEnv });
		for (const path of plan.files) {
			const source = (await git(root, ['show', `${fetchedCommit}:${path}`])).stdout;
			const content = `${source.replaceAll('knowledge-coop', 'treeseed-ai')}\n`;
			const blob = (await git(root, ['hash-object', '-w', '--stdin'], { input: content })).stdout;
			const mode = (await git(root, ['ls-tree', fetchedCommit, '--', path])).stdout.split(/\s+/u)[0] || '100644';
			await git(root, ['update-index', '--add', '--cacheinfo', mode, blob, path], { env: indexEnv });
		}
		const tree = (await git(root, ['write-tree'], { env: indexEnv })).stdout;
		const commit = (await git(root, ['commit-tree', tree, '-p', fetchedCommit, '-m', 'Migrate organization references to treeseed-ai'], { env: { ...process.env, GIT_AUTHOR_NAME: 'TreeSeed migration', GIT_AUTHOR_EMAIL: 'operations@treeseed.dev', GIT_COMMITTER_NAME: 'TreeSeed migration', GIT_COMMITTER_EMAIL: 'operations@treeseed.dev' } })).stdout;
		await git(root, ['push', `https://github.com/${plan.repository}.git`, `${commit}:refs/heads/${plan.branch}`], { env: gitEnv });
		const observed = await remoteHead(projectRoot, plan.repository, plan.branch, gitEnv);
		if (observed !== commit) throw new Error(`Fresh GitHub read-back returned ${observed ?? 'missing'}, expected ${commit}.`);
		return commit;
	});
}

export async function applyOrganizationReferenceMigration(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const planned = await planOrganizationReferenceMigration(input);
	const credential = migrationCredential(input.projectRoot, 'treeseed-ai/platform', input.env);
	const gitEnv = credentialEnvironment(credential.token!);
	const results = [];
	for (const plan of planned.plans) results.push({ ...plan, targetCommit: await applyBranch(input.projectRoot, plan, gitEnv), status: 'verified' as const });
	const machineConfig = loadMachineConfig(input.projectRoot) as { shared?: { secrets?: Record<string, unknown> }; environments?: Record<string, { secrets?: Record<string, unknown> }> };
	const removedCredentials: string[] = [];
	for (const secrets of [machineConfig.shared?.secrets, ...Object.values(machineConfig.environments ?? {}).map((entry) => entry.secrets)]) {
		if (!secrets) continue;
		for (const key of Object.keys(secrets)) {
			if (!key.startsWith('TREESEED_GITHUB_TOKEN_')) continue;
			delete secrets[key];
			removedCredentials.push(key);
		}
	}
	if (removedCredentials.length) writeMachineConfig(input.projectRoot, machineConfig);
	return { ...planned, results, removedCredentials: [...new Set(removedCredentials)].sort() };
}
