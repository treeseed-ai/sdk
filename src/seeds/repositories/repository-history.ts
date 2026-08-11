import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { resolveMachineEnvironmentValues } from '../../operations/services/configuration/config-runtime.js';
import { resolveGitHubCredentialForRepository } from '../../operations/services/configuration/github-credentials.js';
import { classifyGitMode, runRepositoryGit } from '../../operations/services/operations/git-runner.js';
import type { SeedManifest, SeedProjectResource } from '../types.js';

export type ContentRepositoryHistoryPlan = {
	project: string;
	sourcePath: string;
	sourceRepository: string;
	targetRepository: string;
	visibility: 'public' | 'private';
	branches: Array<{ branch: string; sourceRef: string; contentPath: string | null; sourceCommit: string | null; targetCommit: string | null; action: 'create' | 'update' | 'noop' | 'blocked'; reason: string }>;
};

type SeedGitOptions = { env?: NodeJS.ProcessEnv; input?: string; allowFailure?: boolean };

export async function git(cwd: string, args: string[], options: SeedGitOptions = {}) {
	const result = runRepositoryGit(args, { cwd, ...options, mode: classifyGitMode(args) });
	return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), code: result.status ?? 1 };
}

export function credentialEnvironment(token: string) {
	const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
	return {
		...process.env,
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
		GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
		GIT_TERMINAL_PROMPT: '0',
	};
}

export function migrationCredential(projectRoot: string, repository: string, env?: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const values = resolveMachineEnvironmentValues(projectRoot, 'staging');
	return resolveGitHubCredentialForRepository(repository, { values, env: { ...values, ...env } });
}

export async function resolveRef(sourcePath: string, branch: string) {
	for (const candidate of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
		const result = await git(sourcePath, ['rev-parse', '--verify', candidate], { allowFailure: true });
		if (result.code === 0) return { ref: candidate, commit: result.stdout };
	}
	return null;
}

export async function migrationBranches(sourcePath: string) {
	const current = (await git(sourcePath, ['branch', '--show-current'], { allowFailure: true })).stdout;
	return [...new Set(['main', 'staging', ...(current && current !== 'main' && current !== 'staging' ? [current] : [])])];
}

async function contentPathAtRef(sourcePath: string, ref: string) {
	for (const path of ['docs/src/content', 'src/content']) {
		const result = await git(sourcePath, ['cat-file', '-e', `${ref}:${path}`], { allowFailure: true });
		if (result.code === 0) return path;
	}
	return null;
}

async function fetchSourceCommit(sourcePath: string, repository: string, commit: string, env: NodeJS.ProcessEnv) {
	const present = await git(sourcePath, ['cat-file', '-e', `${commit}^{commit}`], { allowFailure: true });
	if (present.code !== 0) await git(sourcePath, ['fetch', '--quiet', '--no-tags', `https://github.com/${repository}.git`, commit], { env });
}

async function contentTreeAtRef(sourcePath: string, ref: string | undefined, contentPath: string | null | undefined) {
	if (!ref || !contentPath) return null;
	const result = await git(sourcePath, ['rev-parse', `${ref}:${contentPath}`], { allowFailure: true });
	return result.code === 0 ? result.stdout : null;
}

export async function remoteHead(sourcePath: string, repository: string, branch: string, env: NodeJS.ProcessEnv) {
	const result = await git(sourcePath, ['ls-remote', `https://github.com/${repository}.git`, `refs/heads/${branch}`], { env, allowFailure: true });
	if (result.code !== 0) throw new Error(`Unable to observe ${repository}@${branch}: ${result.stderr || result.stdout}`);
	return result.stdout.split(/\s+/u)[0] || null;
}

function mappings(manifest: SeedManifest, projectRoot: string, selectedProject?: string) {
	const projects = new Map(manifest.resources.projects.map((project) => [project.key, project]));
	return manifest.resources.hubRepositories.flatMap((target) => {
		const project = projects.get(target.project);
		if (!project || (selectedProject && project.slug !== selectedProject)) return [];
		const forceSkeleton = project.metadata?.contentMigrationMode === 'skeleton';
		const migrationSourcePath = typeof project.metadata?.migrationSourcePath === 'string' ? project.metadata.migrationSourcePath.trim() : '';
		const checkoutPath = migrationSourcePath || project.repository.checkoutPath;
		if (!checkoutPath && !forceSkeleton) throw new Error(`Project ${project.slug} must declare repository.checkoutPath before content history migration.`);
		return [{ project, sourcePath: forceSkeleton ? projectRoot : resolve(projectRoot, checkoutPath!), targetRepository: `${target.owner}/${target.name}`, visibility: target.repositoryPolicy?.visibility ?? 'private', forceSkeleton }];
	});
}

function journalPath(projectRoot: string, repository: string) {
	return resolve(projectRoot, '.treeseed', 'repository-migrations', `${repository.replace('/', '--')}.json`);
}

function migrationJournal(projectRoot: string, repository: string) {
	try {
		return JSON.parse(readFileSync(journalPath(projectRoot, repository), 'utf8')) as {
			receipts?: Array<{ branch?: string; sourceCommit?: string; contentPath?: string | null; targetCommit?: string; verified?: boolean }>;
		};
	} catch {
		return null;
	}
}

export function classifyContentHistoryBranch(input: { sourceCommit: string | null; contentPath: string | null; targetCommit: string | null; receipt?: { sourceCommit?: string; contentPath?: string | null; targetCommit?: string; verified?: boolean } | null }) {
	if (!input.sourceCommit) return { action: 'blocked' as const, reason: 'Source branch is missing.' };
	const verifiedReplay = Boolean(input.targetCommit && input.receipt?.verified === true && input.receipt.sourceCommit === input.sourceCommit && input.receipt.contentPath === input.contentPath && input.receipt.targetCommit === input.targetCommit);
	if (verifiedReplay) return { action: 'noop' as const, reason: 'Live source and target commits match the verified migration receipt.' };
	const ownedTarget = Boolean(input.targetCommit && input.receipt?.verified === true && input.receipt.contentPath === input.contentPath && input.receipt.targetCommit === input.targetCommit);
	if (ownedTarget) return { action: 'update' as const, reason: 'Fast-forward the reconciler-owned content branch to the current live source content.' };
	if (input.targetCommit) return { action: 'blocked' as const, reason: 'Target branch differs from the verified migration journal or has no receipt.' };
	return { action: 'create' as const, reason: input.contentPath ? `Extract ${input.contentPath} with history into src/content.` : 'Create the required content repository skeleton because this source ref has no content path.' };
}

function writeMigrationJournal(projectRoot: string, plan: ContentRepositoryHistoryPlan, receipts: Array<Record<string, unknown>>, status: 'partial' | 'history_verified') {
	const path = journalPath(projectRoot, plan.targetRepository);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, kind: 'treeseed.repository-content-history-migration', project: plan.project, sourceRepository: plan.sourceRepository, targetRepository: plan.targetRepository, status, updatedAt: new Date().toISOString(), receipts }, null, 2)}\n`, 'utf8');
}

function workflow(project: SeedProjectResource) {
	return `name: Publish content\n\non:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\nconcurrency:\n  group: content-\${{ github.repository }}-\${{ github.ref }}\n  cancel-in-progress: false\n\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    environment: \${{ github.ref_name == 'main' && 'production' || (github.ref_name == 'staging' && 'staging' || 'preview') }}\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - uses: actions/checkout@v4\n        with:\n          repository: treeseed-ai/sdk\n          ref: \${{ github.ref_name == 'main' && 'main' || 'staging' }}\n          path: .treeseed/content-publisher\n          persist-credentials: false\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n          cache: npm\n          cache-dependency-path: .treeseed/content-publisher/package-lock.json\n      - name: Build publisher\n        working-directory: .treeseed/content-publisher\n        run: npm ci --ignore-scripts && npm run build:dist\n      - name: Publish exact content commit\n        env:\n          TREESEED_TEAM_ID: treeseed\n          TREESEED_PROJECT_ID: ${project.slug}\n          TREESEED_CLOUDFLARE_ACCOUNT_ID: \${{ vars.TREESEED_CLOUDFLARE_ACCOUNT_ID }}\n          TREESEED_CONTENT_BUCKET_NAME: \${{ vars.TREESEED_CONTENT_BUCKET_NAME }}\n          TREESEED_R2_ACCESS_KEY_ID: \${{ secrets.TREESEED_R2_ACCESS_KEY_ID }}\n          TREESEED_R2_SECRET_ACCESS_KEY: \${{ secrets.TREESEED_R2_SECRET_ACCESS_KEY }}\n        run: node ./.treeseed/content-publisher/dist/scripts/content/publish-content.js --root . --content-path src/content --source-commit "\${GITHUB_SHA}" --ref "\${GITHUB_REF_NAME}" --channel "\${GITHUB_REF_NAME}" > content-publication-receipt.json\n      - uses: actions/upload-artifact@v4\n        with:\n          name: content-publication-\${{ github.sha }}\n          path: content-publication-receipt.json\n`;
}

function license(project: SeedProjectResource, visibility: 'public' | 'private', projectRoot: string) {
	if (visibility === 'private') return 'UNLICENSED\n\nCopyright (c) TreeSeed. All rights reserved. No license is granted.\n';
	return readFileSync(resolve(projectRoot, 'LICENSE'), 'utf8');
}

async function addBlob(sourcePath: string, indexPath: string, path: string, content: string) {
	const blob = await git(sourcePath, ['hash-object', '-w', '--stdin'], { input: content });
	await git(sourcePath, ['update-index', '--add', '--cacheinfo', '100644', blob.stdout, path], { env: { ...process.env, GIT_INDEX_FILE: indexPath } });
}

async function buildContentCommit(input: { projectRoot: string; project: SeedProjectResource; sourcePath: string; sourceRef: string; contentPath: string | null; branch: string; visibility: 'public' | 'private'; targetParent?: string | null }) {
	const temporary = mkdtempSync(resolve(tmpdir(), 'trsd-content-migration-'));
	const indexPath = resolve(temporary, 'index');
	try {
		let parent: string | null = null;
		await git(input.sourcePath, ['read-tree', '--empty'], { env: { ...process.env, GIT_INDEX_FILE: indexPath } });
		if (input.contentPath) {
			parent = (await git(input.sourcePath, ['subtree', 'split', '--prefix', input.contentPath, input.sourceRef])).stdout.split('\n').at(-1) ?? null;
			if (!parent) throw new Error(`Content history extraction produced no commit for ${input.project.slug}@${input.branch}.`);
			const tree = (await git(input.sourcePath, ['rev-parse', `${parent}^{tree}`])).stdout;
			await git(input.sourcePath, ['read-tree', `--prefix=src/content/`, tree], { env: { ...process.env, GIT_INDEX_FILE: indexPath } });
		}
		await addBlob(input.sourcePath, indexPath, 'README.md', `# ${input.project.name} content\n\nAuthoritative content history for \`${input.project.repository.owner}/${input.project.repository.name}\`. Operate content through TreeDX and publish immutable runtime content through the protected workflow.\n`);
		await addBlob(input.sourcePath, indexPath, 'LICENSE', license(input.project, input.visibility, input.projectRoot));
		await addBlob(input.sourcePath, indexPath, '.github/workflows/publish-content.yml', workflow(input.project));
		const tree = (await git(input.sourcePath, ['write-tree'], { env: { ...process.env, GIT_INDEX_FILE: indexPath } })).stdout;
		const historyParent = input.targetParent ?? parent;
		const args = ['commit-tree', tree, ...(historyParent ? ['-p', historyParent] : []), '-m', `${input.targetParent ? 'Reconcile' : 'Migrate'} ${input.project.slug} content history`];
		return (await git(input.sourcePath, args, { env: { ...process.env, GIT_AUTHOR_NAME: 'TreeSeed migration', GIT_AUTHOR_EMAIL: 'operations@treeseed.dev', GIT_COMMITTER_NAME: 'TreeSeed migration', GIT_COMMITTER_EMAIL: 'operations@treeseed.dev' } })).stdout;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

export async function planSeedContentRepositoryHistory(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined>; project?: string }) {
	const plans: ContentRepositoryHistoryPlan[] = [];
	for (const mapping of mappings(input.manifest, input.projectRoot, input.project)) {
		const credential = migrationCredential(input.projectRoot, mapping.targetRepository, input.env);
		if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${mapping.targetRepository}.`);
		const gitEnv = credentialEnvironment(credential.token);
		const sourceRepository = `${mapping.project.repository.owner}/${mapping.project.repository.name}`;
		const journal = migrationJournal(input.projectRoot, mapping.targetRepository);
		const branches: ContentRepositoryHistoryPlan['branches'] = [];
		for (const branch of await migrationBranches(mapping.sourcePath)) {
			const liveSourceCommit = await remoteHead(mapping.sourcePath, sourceRepository, branch, gitEnv);
			if (liveSourceCommit) await fetchSourceCommit(mapping.sourcePath, sourceRepository, liveSourceCommit, gitEnv);
			const source = liveSourceCommit ? { ref: liveSourceCommit, commit: liveSourceCommit } : null;
			const targetCommit = await remoteHead(mapping.sourcePath, mapping.targetRepository, branch, gitEnv);
			const contentPath = source && !mapping.forceSkeleton ? await contentPathAtRef(mapping.sourcePath, source.ref) : null;
			const receipt = journal?.receipts?.find((entry) => entry.branch === branch);
			if (receipt?.sourceCommit) await fetchSourceCommit(mapping.sourcePath, sourceRepository, receipt.sourceCommit, gitEnv);
			const previousTree = await contentTreeAtRef(mapping.sourcePath, receipt?.sourceCommit, receipt?.contentPath);
			const currentTree = await contentTreeAtRef(mapping.sourcePath, source?.commit, contentPath);
			const contentUnchanged = Boolean(
				receipt?.verified
				&& receipt.targetCommit === targetCommit
				&& receipt.contentPath === contentPath
				&& receipt.sourceCommit !== source?.commit
				&& (mapping.forceSkeleton || (previousTree && previousTree === currentTree)),
			);
			const classification = contentUnchanged
				? { action: 'noop' as const, reason: 'Live source advanced without changing the authoritative content tree.' }
				: classifyContentHistoryBranch({ sourceCommit: source?.commit ?? null, contentPath, targetCommit, receipt });
			branches.push({ branch, sourceRef: source?.ref ?? branch, contentPath, sourceCommit: source?.commit ?? null, targetCommit, action: classification.action, reason: !source ? `Source branch ${branch} is missing.` : classification.reason });
		}
		plans.push({ project: mapping.project.slug, sourcePath: mapping.sourcePath, sourceRepository, targetRepository: mapping.targetRepository, visibility: mapping.visibility, branches });
	}
	return plans;
}

export async function applySeedContentRepositoryHistory(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined>; project: string }) {
	const plans = await planSeedContentRepositoryHistory(input);
	if (plans.length !== 1) throw new Error(`Expected exactly one content migration for project ${input.project}.`);
	const plan = plans[0]!;
	if (plan.branches.some((branch) => branch.action === 'blocked')) throw new Error(plan.branches.filter((branch) => branch.action === 'blocked').map((branch) => branch.reason).join(' '));
	const project = input.manifest.resources.projects.find((entry) => entry.slug === plan.project)!;
	const credential = migrationCredential(input.projectRoot, plan.targetRepository, input.env);
	const gitEnv = credentialEnvironment(credential.token!);
	const receipts = [];
	for (const branch of plan.branches) {
		if (branch.action === 'noop') {
			receipts.push({ branch: branch.branch, sourceRef: branch.sourceRef, sourceCommit: branch.sourceCommit, contentPath: branch.contentPath, targetCommit: branch.targetCommit, verified: true });
			continue;
		}
		if (branch.action === 'update' && branch.targetCommit) await fetchSourceCommit(plan.sourcePath, plan.targetRepository, branch.targetCommit, gitEnv);
		const commit = await buildContentCommit({ projectRoot: input.projectRoot, project, sourcePath: plan.sourcePath, sourceRef: branch.sourceRef, contentPath: branch.contentPath, branch: branch.branch, visibility: plan.visibility, targetParent: branch.action === 'update' ? branch.targetCommit : null });
		await git(plan.sourcePath, ['push', `https://github.com/${plan.targetRepository}.git`, `${commit}:refs/heads/${branch.branch}`], { env: gitEnv });
		const observed = await remoteHead(plan.sourcePath, plan.targetRepository, branch.branch, gitEnv);
		if (observed !== commit) throw new Error(`Fresh GitHub read-back for ${plan.targetRepository}@${branch.branch} returned ${observed ?? 'missing'}, expected ${commit}.`);
		receipts.push({ branch: branch.branch, sourceRef: branch.sourceRef, sourceCommit: branch.sourceCommit, contentPath: branch.contentPath, targetCommit: commit, verified: true });
		writeMigrationJournal(input.projectRoot, plan, receipts, receipts.length === plan.branches.length ? 'history_verified' : 'partial');
	}
	writeMigrationJournal(input.projectRoot, plan, receipts, 'history_verified');
	return { ...plan, status: 'history_verified' as const, receipts, journalPath: journalPath(input.projectRoot, plan.targetRepository) };
}
