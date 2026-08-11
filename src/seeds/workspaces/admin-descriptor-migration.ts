import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { credentialEnvironment, git, migrationCredential, remoteHead } from '../repositories/repository-history.js';
import type { SeedManifest } from '../types.js';

type DescriptorFile = { path: string; content: string };

export type AdminDescriptorMigrationPlan = {
	repository: string;
	branch: 'staging';
	sourceCommit: string;
	sdkRef: string;
	action: 'update' | 'noop';
	reason: string;
};

function apiProject(manifest: SeedManifest) {
	const project = manifest.resources.projects.find((entry) => entry.slug === 'api');
	if (!project) throw new Error(`Seed ${manifest.name} does not declare the Admin API project.`);
	return project;
}

async function withFetched<T>(repository: string, gitEnv: NodeJS.ProcessEnv, operation: (root: string, commit: string) => Promise<T>) {
	const temporary = mkdtempSync(resolve(tmpdir(), 'trsd-admin-descriptor-'));
	try {
		await git(temporary, ['init', '--quiet']);
		await git(temporary, ['fetch', '--quiet', '--no-tags', `https://github.com/${repository}.git`, 'refs/heads/staging'], { env: gitEnv });
		return await operation(temporary, (await git(temporary, ['rev-parse', 'FETCH_HEAD'])).stdout);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

async function desiredFiles(projectRoot: string, root: string, commit: string, sdkRef: string) {
	const metadata = JSON.parse((await git(root, ['show', `${commit}:package.json`])).stdout) as { files?: string[]; exports?: Record<string, unknown>; dependencies?: Record<string, string> };
	metadata.files = [...new Set([...(metadata.files ?? []), 'LICENSE', 'COMMERCIAL.md'])];
	metadata.exports = { ...(metadata.exports ?? {}), './admin-api-descriptor.json': './dist/admin-api-descriptor.json' };
	metadata.dependencies = { ...(metadata.dependencies ?? {}), '@treeseed/sdk': `github:treeseed-ai/sdk#${sdkRef}` };
	return [
		{ path: 'package.json', content: `${JSON.stringify(metadata, null, 2)}\n` },
		{ path: 'scripts/build/build-dist.ts', content: readFileSync(resolve(projectRoot, 'packages/api/scripts/build/build-dist.ts'), 'utf8') },
		{ path: '.github/workflows/release-gate.yml', content: readFileSync(resolve(projectRoot, 'packages/api/.github/workflows/release-gate.yml'), 'utf8') },
	] satisfies DescriptorFile[];
}

async function matches(root: string, commit: string, files: DescriptorFile[]) {
	for (const file of files) {
		const observed = await git(root, ['show', `${commit}:${file.path}`], { allowFailure: true });
		if (observed.code !== 0 || observed.stdout !== file.content.trimEnd()) return false;
	}
	return true;
}

export async function planAdminDescriptorMigration(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const project = apiProject(input.manifest);
	const repository = `${project.repository.owner}/${project.repository.name}`;
	const credential = migrationCredential(input.projectRoot, repository, input.env);
	if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${repository}.`);
	const gitEnv = credentialEnvironment(credential.token);
	const sdkRef = await remoteHead(input.projectRoot, 'treeseed-ai/sdk', 'staging', gitEnv);
	if (!sdkRef) throw new Error('Live SDK staging ref is required for the Admin API descriptor migration.');
	return withFetched(repository, gitEnv, async (root, sourceCommit) => {
		const current = await matches(root, sourceCommit, await desiredFiles(input.projectRoot, root, sourceCommit, sdkRef));
		return { repository, branch: 'staging', sourceCommit, sdkRef, action: current ? 'noop' : 'update', reason: current ? 'Live staging builds and exports the Admin descriptor against the verified SDK ref.' : 'Fast-forward the Admin descriptor build/export contract and verified SDK ref on staging.' } satisfies AdminDescriptorMigrationPlan;
	});
}

export async function applyAdminDescriptorMigration(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const plan = await planAdminDescriptorMigration(input);
	if (plan.action === 'noop') return { ...plan, targetCommit: plan.sourceCommit, status: 'verified' as const };
	const credential = migrationCredential(input.projectRoot, plan.repository, input.env);
	const gitEnv = credentialEnvironment(credential.token!);
	const targetCommit = await withFetched(plan.repository, gitEnv, async (root, fetchedCommit) => {
		if (fetchedCommit !== plan.sourceCommit) throw new Error(`Stale Admin descriptor plan for ${plan.repository}@staging.`);
		const indexPath = resolve(root, 'migration-index');
		const indexEnv = { ...process.env, GIT_INDEX_FILE: indexPath };
		await git(root, ['read-tree', fetchedCommit], { env: indexEnv });
		for (const file of await desiredFiles(input.projectRoot, root, fetchedCommit, plan.sdkRef)) {
			const blob = (await git(root, ['hash-object', '-w', '--stdin'], { input: file.content })).stdout;
			await git(root, ['update-index', '--add', '--cacheinfo', '100644', blob, file.path], { env: indexEnv });
		}
		const tree = (await git(root, ['write-tree'], { env: indexEnv })).stdout;
		const commit = (await git(root, ['commit-tree', tree, '-p', fetchedCommit, '-m', 'Publish versioned Admin API descriptor build contract'], { env: { ...process.env, GIT_AUTHOR_NAME: 'TreeSeed migration', GIT_AUTHOR_EMAIL: 'operations@treeseed.dev', GIT_COMMITTER_NAME: 'TreeSeed migration', GIT_COMMITTER_EMAIL: 'operations@treeseed.dev' } })).stdout;
		await git(root, ['push', `https://github.com/${plan.repository}.git`, `${commit}:refs/heads/staging`], { env: gitEnv });
		return commit;
	});
	const observed = await remoteHead(input.projectRoot, plan.repository, 'staging', gitEnv);
	if (observed !== targetCommit) throw new Error(`Fresh GitHub read-back returned ${observed ?? 'missing'}, expected ${targetCommit}.`);
	return { ...plan, targetCommit, status: 'verified' as const };
}
