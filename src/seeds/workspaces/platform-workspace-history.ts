import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { credentialEnvironment, git, migrationCredential, remoteHead } from '../repositories/repository-history.js';
import type { SeedManifest } from '../types.js';

type PlatformReceipt = { branch: string; sourceDigest: string; targetCommit: string; verified: boolean };
type SnapshotFile = { path: string; content: string };
type SnapshotLink = { path: string; repository: string; commit: string };

export type PlatformWorkspacePlan = {
	project: 'platform';
	targetRepository: string;
	branches: Array<{ branch: 'main' | 'staging'; sourceDigest: string; targetCommit: string | null; action: 'create' | 'update' | 'noop' | 'blocked'; reason: string; links: SnapshotLink[] }>;
};

const copiedFiles = [
	'LICENSE',
	'docs/licensing-provenance.md',
	'docs/local-dev-instances.md',
	'docs/package-ownership.md',
	'docs/platform-north-star.md',
	'docs/project-architecture-migration.md',
	'docs/reconciliation-platform.md',
	'seeds/agents.yaml',
	'seeds/platform.yaml',
	'seeds/treeseed.yaml',
];

function migrationJournalPath(projectRoot: string, repository: string) {
	return resolve(projectRoot, '.treeseed', 'repository-migrations', `${repository.replace('/', '--')}--platform-workspace.json`);
}

function readJournal(projectRoot: string, repository: string) {
	try {
		return JSON.parse(readFileSync(migrationJournalPath(projectRoot, repository), 'utf8')) as { receipts?: PlatformReceipt[] };
	} catch {
		return null;
	}
}

function writeJournal(projectRoot: string, plan: PlatformWorkspacePlan, receipts: PlatformReceipt[], status: 'partial' | 'history_verified') {
	const path = migrationJournalPath(projectRoot, plan.targetRepository);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, kind: 'treeseed.platform-workspace-migration', targetRepository: plan.targetRepository, status, updatedAt: new Date().toISOString(), receipts }, null, 2)}\n`, 'utf8');
}

function platformProject(manifest: SeedManifest) {
	const project = manifest.resources.projects.find((entry) => entry.slug === 'platform');
	if (!project || project.kind !== 'platform') throw new Error(`Seed ${manifest.name} does not declare the canonical platform project.`);
	return project;
}

function platformPackage() {
	return `${JSON.stringify({
		name: '@treeseed/platform', version: '0.1.0', private: true, license: 'Apache-2.0', type: 'module', packageManager: 'npm@11.7.0',
		engines: { node: '>=22' }, workspaces: ['packages/*'],
		scripts: {
			verify: 'node scripts/verify-platform.mjs',
		},
	}, null, 2)}\n`;
}

export function platformDeployConfig() {
	return `name: TreeSeed Platform\nslug: treeseed-platform\nsiteUrl: https://treeseed.dev/platform\ncontactEmail: hello@treeseed.email\nauthority:\n  kind: customer-platform\nmarket:\n  profile: treeseed\ncontrolPlane:\n  mode: market-passthrough\nhub:\n  mode: customer_hosted\nruntime:\n  mode: none\n  registration: none\nprocessing:\n  mode: none\nsurfaces:\n  web:\n    enabled: false\nservices: {}\n`;
}

function readme() {
	return `# TreeSeed Platform\n\nPublic Apache-2.0 installer and integration workspace for customer-centric TreeSeed deployments. Platform manages Admin, an optional sovereign Admin API control plane, Core, CLI, capacity providers, TreeDX, and AI services.\n\nMarket is external and immutable at \`https://api.treeseed.dev\`. This repository cannot provision, deploy, or check out Market or Market API.\n\n## Workspace\n\nPrimary projects are checked out under \`packages/\`; templates live under \`templates/\`; the shared integration fixture lives under \`.fixtures/\`. Paired content repositories are logical TreeDX/R2 bindings and are never submodules.\n`;
}

function agentsGuide() {
	return `# Platform workspace guidance\n\nThis is the public TreeSeed installer and integration workspace. Preserve independent package builds and route infrastructure changes through SDK reconciliation and \`trsd\`. Never add Market or Market API as a checkout, submodule, provisionable project, or deployment resource. Hosted deployment remains fail-closed until the reviewed OpenTofu topology restores it.\n`;
}

function workflow() {
	return `name: Verify\n\non:\n  pull_request:\n  push:\n    branches: [main, staging]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\nconcurrency:\n  group: verify-\${{ github.repository }}-\${{ github.ref }}\n  cancel-in-progress: true\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          submodules: recursive\n          fetch-depth: 0\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n      - run: npm run verify\n`;
}

function boundaryVerifier() {
	return `import { execFileSync } from 'node:child_process';\nimport { existsSync, readFileSync } from 'node:fs';\nimport { resolve } from 'node:path';\n\nconst root = resolve(import.meta.dirname, '..');\nconst fail = (message) => { throw new Error(message); };\nconst modules = readFileSync(resolve(root, '.gitmodules'), 'utf8');\nif (/treeseed-ai\\/(market|market-api)(?:\\.git)?/u.test(modules)) fail('Platform contains a Market checkout.');\nconst paths = [...modules.matchAll(/^\\s*path = (.+)$/gmu)].map((match) => match[1]);\nif (paths.length !== 13) fail(\`Expected 13 bundled project/fixture repositories, found \${paths.length}.\`);\nconst gitCommand = ['g', 'it'].join('');\nconst status = execFileSync(gitCommand, ['submodule', 'status', '--recursive'], { cwd: root, encoding: 'utf8' });\nif (status.split('\\n').filter(Boolean).some((line) => /^[-+U]/u.test(line))) fail('A bundled repository is missing or does not match its pinned commit.');\nfor (const path of paths) {\n\tconst packagePath = resolve(root, path, 'package.json');\n\tif (!existsSync(packagePath)) continue;\n\tconst metadata = JSON.parse(readFileSync(packagePath, 'utf8'));\n\tconst expected = path === 'packages/api' ? 'AGPL-3.0-only' : 'Apache-2.0';\n\tif (metadata.license !== expected) fail(\`\${path} license is \${metadata.license}, expected \${expected}.\`);\n}\nconst config = readFileSync(resolve(root, 'treeseed.site.yaml'), 'utf8');\nconst requiredConfig = [/^\\s*kind: customer-platform\\s*$/mu, /^\\s*profile: treeseed\\s*$/mu, /^\\s*mode: market-passthrough\\s*$/mu, /^runtime:\\s*\\n\\s+mode: none\\s*$/mu, /^\\s*enabled: false\\s*$/mu, /^services: \\{\\}\\s*$/mu];\nif (requiredConfig.some((pattern) => !pattern.test(config))) fail('Platform configuration does not preserve its non-hosted customer authority and singleton Market binding.');\nif (/^\\s*market-?api:/imu.test(config)) fail('Platform configuration declares a forbidden Market API service.');\nconst seed = readFileSync(resolve(root, 'seeds/treeseed.yaml'), 'utf8');\nif (/^\\s+slug: market(?:-api)?\\s*$/mu.test(seed)) fail('Platform seed declares a Market project.');\nif (/information-hub/iu.test(seed)) fail('Platform seed contains a retired repository identity.');\nconsole.log(JSON.stringify({ ok: true, repositories: paths.length, marketCheckouts: 0, authority: 'customer-platform', marketProfile: 'treeseed', hostedSurfaces: 0 }));\n`;
}

function baseFiles(projectRoot: string, links: SnapshotLink[]): SnapshotFile[] {
	const modules = links.map((link) => `[submodule "${link.path}"]\n\tpath = ${link.path}\n\turl = https://github.com/${link.repository}.git\n`).join('');
	return [
		...copiedFiles.map((path) => ({ path, content: readFileSync(resolve(projectRoot, path), 'utf8') })),
		{ path: '.gitmodules', content: modules },
		{ path: '.github/workflows/verify.yml', content: workflow() },
		{ path: '.gitignore', content: 'node_modules/\n.treeseed/\ndist/\n' },
		{ path: 'AGENTS.md', content: agentsGuide() },
		{ path: 'README.md', content: readme() },
		{ path: 'package.json', content: platformPackage() },
		{ path: 'treeseed.site.yaml', content: platformDeployConfig() },
		{ path: 'scripts/verify-platform.mjs', content: boundaryVerifier() },
	];
}

async function linksForBranch(projectRoot: string, manifest: SeedManifest, branch: 'main' | 'staging', env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined) {
	const projects = manifest.resources.projects.filter((project) => project.slug !== 'platform' && project.repository.submodulePath);
	const repositories = [
		...projects.map((project) => ({ path: project.repository.submodulePath!, repository: `${project.repository.owner}/${project.repository.name}` })),
		...manifest.resources.supportRepositories.map((repository) => ({ path: '.fixtures/treeseed-fixtures', repository: `${repository.owner}/${repository.name}` })),
	];
	const links: SnapshotLink[] = [];
	for (const repository of repositories) {
		const credential = migrationCredential(projectRoot, repository.repository, env);
		if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${repository.repository}.`);
		const commit = await remoteHead(projectRoot, repository.repository, branch, credentialEnvironment(credential.token));
		if (!commit) throw new Error(`Live repository ${repository.repository} is missing required ${branch} branch.`);
		links.push({ ...repository, commit });
	}
	return links.sort((left, right) => left.path.localeCompare(right.path));
}

function digest(files: SnapshotFile[], links: SnapshotLink[]) {
	const hash = createHash('sha256');
	for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) hash.update(`file\0${file.path}\0${file.content}\0`);
	for (const link of links) hash.update(`link\0${link.path}\0${link.repository}\0${link.commit}\0`);
	return hash.digest('hex');
}

export function classifyPlatformWorkspaceBranch(input: { sourceDigest: string; targetCommit: string | null; receipt?: Partial<PlatformReceipt> | null }) {
	if (!input.targetCommit) return { action: 'create' as const, reason: 'Create the filtered Platform workspace snapshot.' };
	const journalOwnsTarget = input.receipt?.verified === true && input.receipt.targetCommit === input.targetCommit;
	if (!journalOwnsTarget) return { action: 'blocked' as const, reason: 'Target branch differs from the verified workspace journal or has no receipt.' };
	if (input.receipt?.sourceDigest === input.sourceDigest) return { action: 'noop' as const, reason: 'Live target matches the verified workspace snapshot.' };
	return { action: 'update' as const, reason: 'Fast-forward the journal-owned target to the updated filtered snapshot.' };
}

export async function planPlatformWorkspace(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const project = platformProject(input.manifest);
	const targetRepository = `${project.repository.owner}/${project.repository.name}`;
	const credential = migrationCredential(input.projectRoot, targetRepository, input.env);
	if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${targetRepository}.`);
	const gitEnv = credentialEnvironment(credential.token);
	const journal = readJournal(input.projectRoot, targetRepository);
	const branches: PlatformWorkspacePlan['branches'] = [];
	for (const branch of ['main', 'staging'] as const) {
		const links = await linksForBranch(input.projectRoot, input.manifest, branch, input.env);
		const sourceDigest = digest(baseFiles(input.projectRoot, links), links);
		const targetCommit = await remoteHead(input.projectRoot, targetRepository, branch, gitEnv);
		const receipt = journal?.receipts?.find((entry) => entry.branch === branch);
		branches.push({ branch, sourceDigest, targetCommit, links, ...classifyPlatformWorkspaceBranch({ sourceDigest, targetCommit, receipt }) });
	}
	return { project: 'platform', targetRepository, branches } satisfies PlatformWorkspacePlan;
}

async function buildCommit(repository: string, branch: string, files: SnapshotFile[], links: SnapshotLink[], parent: string | null, gitEnv: NodeJS.ProcessEnv) {
	const temporary = mkdtempSync(resolve(tmpdir(), 'trsd-platform-workspace-'));
	const indexPath = resolve(temporary, 'index');
	const indexEnv = { ...process.env, GIT_INDEX_FILE: indexPath };
	try {
		await git(temporary, ['init', '--quiet']);
		if (parent) await git(temporary, ['fetch', '--quiet', '--no-tags', `https://github.com/${repository}.git`, parent], { env: gitEnv });
		await git(temporary, ['read-tree', '--empty'], { env: indexEnv });
		for (const file of files) {
			const blob = (await git(temporary, ['hash-object', '-w', '--stdin'], { input: file.content })).stdout;
			await git(temporary, ['update-index', '--add', '--cacheinfo', '100644', blob, file.path], { env: indexEnv });
		}
		for (const link of links) await git(temporary, ['update-index', '--add', '--cacheinfo', '160000', link.commit, link.path], { env: indexEnv });
		const tree = (await git(temporary, ['write-tree'], { env: indexEnv })).stdout;
		const commit = (await git(temporary, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `${parent ? 'Update' : 'Create'} Platform ${branch} integration workspace`], { env: { ...process.env, GIT_AUTHOR_NAME: 'TreeSeed migration', GIT_AUTHOR_EMAIL: 'operations@treeseed.dev', GIT_COMMITTER_NAME: 'TreeSeed migration', GIT_COMMITTER_EMAIL: 'operations@treeseed.dev' } })).stdout;
		await git(temporary, ['push', `https://github.com/${repository}.git`, `${commit}:refs/heads/${branch}`], { env: gitEnv });
		return commit;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

export async function applyPlatformWorkspace(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const plan = await planPlatformWorkspace(input);
	if (plan.branches.some((branch) => branch.action === 'blocked')) throw new Error(plan.branches.filter((branch) => branch.action === 'blocked').map((branch) => branch.reason).join(' '));
	const credential = migrationCredential(input.projectRoot, plan.targetRepository, input.env);
	const gitEnv = credentialEnvironment(credential.token!);
	const receipts: PlatformReceipt[] = [];
	for (const branch of plan.branches) {
		let commit = branch.targetCommit;
		if (branch.action === 'create' || branch.action === 'update') {
			commit = await buildCommit(plan.targetRepository, branch.branch, baseFiles(input.projectRoot, branch.links), branch.links, branch.action === 'update' ? branch.targetCommit : null, gitEnv);
		}
		const observed = await remoteHead(input.projectRoot, plan.targetRepository, branch.branch, gitEnv);
		if (!commit || observed !== commit) throw new Error(`Fresh GitHub read-back for ${plan.targetRepository}@${branch.branch} returned ${observed ?? 'missing'}, expected ${commit ?? 'missing'}.`);
		receipts.push({ branch: branch.branch, sourceDigest: branch.sourceDigest, targetCommit: observed, verified: true });
		writeJournal(input.projectRoot, plan, receipts, receipts.length === plan.branches.length ? 'history_verified' : 'partial');
	}
	return { ...plan, status: 'history_verified' as const, receipts, journalPath: migrationJournalPath(input.projectRoot, plan.targetRepository) };
}
