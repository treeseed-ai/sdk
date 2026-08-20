import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { credentialEnvironment, git, migrationCredential, remoteHead } from '../repositories/repository-history.js';
import type { SeedManifest, SeedProjectResource } from '../types.js';

type LicenseKind = 'Apache-2.0' | 'AGPL-3.0-only';
type LicenseFile = { path: string; content: string };
type Receipt = { branch: string; sourceCommit: string; targetCommit: string; contentDigest: string; verified: boolean };

export const apiLicensePolicyPaths = [
	'COMMERCIAL.md',
	'CONTRIBUTING.md',
	'.github/PULL_REQUEST_TEMPLATE.md',
	'.github/approved-committers.json',
	'.github/COMMITTER_APPROVAL.md',
	'.github/ISSUE_TEMPLATE/agpl-committer-approval.yml',
	'.github/workflows/agpl-committer-authorization.yml',
	'docs/licensing-provenance.md',
] as const;

export type PortfolioLicensePlan = {
	project: string;
	repository: string;
	license: LicenseKind;
	contentDigest: string;
	branches: Array<{ branch: 'main' | 'staging'; sourceCommit: string; action: 'update' | 'noop'; reason: string }>;
};

function projectFor(manifest: SeedManifest, slug: string) {
	const project = manifest.resources.projects.find((entry) => entry.slug === slug);
	if (!project) throw new Error(`Seed ${manifest.name} does not declare project ${slug}.`);
	if (project.metadata?.visibility !== 'public') throw new Error(`Portfolio license migration is limited to public projects; ${slug} is not public.`);
	return project;
}

function expectedLicense(project: SeedProjectResource): LicenseKind {
	return project.slug === 'api' ? 'AGPL-3.0-only' : 'Apache-2.0';
}

function journalPath(projectRoot: string, repository: string) {
	return resolve(projectRoot, '.treeseed', 'repository-migrations', `${repository.replace('/', '--')}--license.json`);
}

function writeJournal(projectRoot: string, plan: PortfolioLicensePlan, receipts: Receipt[]) {
	const path = journalPath(projectRoot, plan.repository);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, kind: 'treeseed.portfolio-license-migration', project: plan.project, repository: plan.repository, license: plan.license, status: receipts.length === plan.branches.length ? 'verified' : 'partial', updatedAt: new Date().toISOString(), receipts }, null, 2)}\n`, 'utf8');
}

function supplementalFiles(projectRoot: string, project: SeedProjectResource) {
	if (project.slug !== 'api') return [];
	return apiLicensePolicyPaths
		.map((path) => ({ path, content: readFileSync(resolve(projectRoot, 'packages/api', path), 'utf8') }));
}

async function desiredFiles(projectRoot: string, root: string, commit: string, project: SeedProjectResource) {
	const license = expectedLicense(project);
	const licensePath = license === 'AGPL-3.0-only' ? resolve(projectRoot, 'packages/api/LICENSE') : resolve(projectRoot, 'LICENSE');
	const files: LicenseFile[] = [{ path: 'LICENSE', content: readFileSync(licensePath, 'utf8') }, ...supplementalFiles(projectRoot, project)];
	const packageResult = await git(root, ['show', `${commit}:package.json`], { allowFailure: true });
	if (packageResult.code === 0) {
		const metadata = JSON.parse(packageResult.stdout) as Record<string, unknown>;
		metadata.license = license;
		if (metadata.repository && typeof metadata.repository === 'object' && !Array.isArray(metadata.repository)) {
			(metadata.repository as Record<string, unknown>).url = `https://github.com/${project.repository.owner}/${project.repository.name}.git`;
		}
		files.push({ path: 'package.json', content: `${JSON.stringify(metadata, null, 2)}\n` });
	}
	return files;
}

function digest(files: LicenseFile[]) {
	const hash = createHash('sha256');
	for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) hash.update(`${file.path}\0${file.content}\0`);
	return hash.digest('hex');
}

async function withFetchedBranch<T>(input: { repository: string; branch: string; gitEnv: NodeJS.ProcessEnv }, operation: (root: string, commit: string) => Promise<T>) {
	const temporary = mkdtempSync(resolve(tmpdir(), 'trsd-license-migration-'));
	try {
		await git(temporary, ['init', '--quiet']);
		await git(temporary, ['fetch', '--quiet', '--no-tags', `https://github.com/${input.repository}.git`, `refs/heads/${input.branch}`], { env: input.gitEnv });
		return await operation(temporary, (await git(temporary, ['rev-parse', 'FETCH_HEAD'])).stdout);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

async function filesMatch(root: string, commit: string, files: LicenseFile[]) {
	for (const file of files) {
		const observed = await git(root, ['show', `${commit}:${file.path}`], { allowFailure: true, preserveOutput: true });
		if (observed.code !== 0 || observed.stdout !== file.content) return false;
	}
	return true;
}

export async function planPortfolioLicense(input: { projectRoot: string; manifest: SeedManifest; project: string; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const project = projectFor(input.manifest, input.project);
	const repository = `${project.repository.owner}/${project.repository.name}`;
	const credential = migrationCredential(input.projectRoot, repository, input.env);
	if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${repository}.`);
	const gitEnv = credentialEnvironment(credential.token);
	const branches: PortfolioLicensePlan['branches'] = [];
	let contentDigest = '';
	for (const branch of ['main', 'staging'] as const) {
		const result = await withFetchedBranch({ repository, branch, gitEnv }, async (root, sourceCommit) => {
			const files = await desiredFiles(input.projectRoot, root, sourceCommit, project);
			return { sourceCommit, files, matches: await filesMatch(root, sourceCommit, files) };
		});
		contentDigest = digest(result.files);
		branches.push({ branch, sourceCommit: result.sourceCommit, action: result.matches ? 'noop' : 'update', reason: result.matches ? `Live branch has the required ${expectedLicense(project)} license files.` : `Fast-forward only the governed ${expectedLicense(project)} license files.` });
	}
	return { project: project.slug, repository, license: expectedLicense(project), contentDigest, branches } satisfies PortfolioLicensePlan;
}

async function applyBranch(input: { projectRoot: string; project: SeedProjectResource; repository: string; branch: string; sourceCommit: string; gitEnv: NodeJS.ProcessEnv }) {
	return withFetchedBranch({ repository: input.repository, branch: input.branch, gitEnv: input.gitEnv }, async (root, fetchedCommit) => {
		if (fetchedCommit !== input.sourceCommit) throw new Error(`Stale license plan for ${input.repository}@${input.branch}.`);
		const files = await desiredFiles(input.projectRoot, root, fetchedCommit, input.project);
		const indexPath = resolve(root, 'migration-index');
		const indexEnv = { ...process.env, GIT_INDEX_FILE: indexPath };
		await git(root, ['read-tree', fetchedCommit], { env: indexEnv });
		for (const file of files) {
			const blob = (await git(root, ['hash-object', '-w', '--stdin'], { input: file.content })).stdout;
			await git(root, ['update-index', '--add', '--cacheinfo', '100644', blob, file.path], { env: indexEnv });
		}
		const tree = (await git(root, ['write-tree'], { env: indexEnv })).stdout;
		const commit = (await git(root, ['commit-tree', tree, '-p', fetchedCommit, '-m', `Apply ${expectedLicense(input.project)} repository license`], { env: { ...process.env, GIT_AUTHOR_NAME: 'TreeSeed migration', GIT_AUTHOR_EMAIL: 'operations@treeseed.dev', GIT_COMMITTER_NAME: 'TreeSeed migration', GIT_COMMITTER_EMAIL: 'operations@treeseed.dev' } })).stdout;
		await git(root, ['push', `https://github.com/${input.repository}.git`, `${commit}:refs/heads/${input.branch}`], { env: input.gitEnv });
		return commit;
	});
}

export async function applyPortfolioLicense(input: { projectRoot: string; manifest: SeedManifest; project: string; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const plan = await planPortfolioLicense(input);
	const project = projectFor(input.manifest, input.project);
	const credential = migrationCredential(input.projectRoot, plan.repository, input.env);
	const gitEnv = credentialEnvironment(credential.token!);
	const receipts: Receipt[] = [];
	for (const branch of plan.branches) {
		const targetCommit = branch.action === 'update' ? await applyBranch({ projectRoot: input.projectRoot, project, repository: plan.repository, branch: branch.branch, sourceCommit: branch.sourceCommit, gitEnv }) : branch.sourceCommit;
		const observed = await remoteHead(input.projectRoot, plan.repository, branch.branch, gitEnv);
		if (observed !== targetCommit) throw new Error(`Fresh GitHub read-back for ${plan.repository}@${branch.branch} returned ${observed ?? 'missing'}, expected ${targetCommit}.`);
		receipts.push({ branch: branch.branch, sourceCommit: branch.sourceCommit, targetCommit, contentDigest: plan.contentDigest, verified: true });
		writeJournal(input.projectRoot, plan, receipts);
	}
	return { ...plan, status: 'verified' as const, receipts, journalPath: journalPath(input.projectRoot, plan.repository) };
}
