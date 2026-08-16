import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { credentialEnvironment, git, migrationCredential, remoteHead } from '../repositories/repository-history.js';
import type { SeedManifest } from '../types.js';

type WorkspaceBranch = 'main' | 'staging';
type PlatformReceipt = { branch: WorkspaceBranch; sourceRef: string; sourceDigest: string; targetCommit: string; verified: boolean };
type SnapshotFile = { path: string; content: string };
export type SnapshotLink = { path: string; repository: string; commit: string };

export type PlatformWorkspacePlan = {
	project: 'platform';
	targetRepository: string;
	sourceRef: string;
	branches: Array<{ branch: WorkspaceBranch; sourceDigest: string; targetCommit: string | null; action: 'create' | 'update' | 'noop' | 'blocked'; reason: string; links: SnapshotLink[] }>;
};

const copiedFiles = [
	'LICENSE',
	'docs/licensing-provenance.md',
	'docs/local-dev-instances.md',
	'docs/package-ownership.md',
	'docs/platform-north-star.md',
	'docs/production-readiness-migration-ledger.md',
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

function writeJournal(projectRoot: string, plan: PlatformWorkspacePlan, receipts: PlatformReceipt[]) {
	const path = migrationJournalPath(projectRoot, plan.targetRepository);
	mkdirSync(dirname(path), { recursive: true });
	const verified = new Set(receipts.filter((receipt) => receipt.verified).map((receipt) => receipt.branch));
	const status = verified.has('main') && verified.has('staging') ? 'history_verified' : 'partial';
	writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, kind: 'treeseed.platform-workspace-migration', targetRepository: plan.targetRepository, status, updatedAt: new Date().toISOString(), receipts }, null, 2)}\n`, 'utf8');
}

function mergeReceipts(previous: PlatformReceipt[], current: PlatformReceipt[]) {
	const byBranch = new Map(previous.map((receipt) => [receipt.branch, receipt]));
	for (const receipt of current) byBranch.set(receipt.branch, receipt);
	return [...byBranch.values()].sort((left, right) => left.branch.localeCompare(right.branch));
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
	return `name: TreeSeed Platform\nslug: treeseed-platform\nsiteUrl: https://treeseed.dev/platform\ncontactEmail: hello@treeseed.email\nauthority: { kind: customer-platform }\nmarket: { profile: treeseed }\ncontrolPlane: { mode: managed }\nhub: { mode: customer_hosted }\nruntime: { mode: none, registration: none }\nprocessing: { mode: local, providerRef: codex-sub }\nsurfaces: { web: { enabled: true }, admin: { enabled: true }, api: { enabled: true } }\nservices:\n  api: { enabled: true, provider: local }\n  treeseedDatabase: { enabled: true, provider: local }\n  operationsRunner: { enabled: true, provider: local }\n  treedx: { enabled: true, provider: local }\n  agentProvider: { enabled: true, provider: local }\npublicTreeDxFederation: {}\n`;
}

function readme() {
	return `# TreeSeed Platform\n\nPublic Apache-2.0 installer and integration workspace for customer-centric TreeSeed deployments. Platform manages Admin, an optional sovereign Admin API control plane, Core, CLI, capacity providers, TreeDX, and AI services.\n\nMarket is external and immutable at \`https://api.treeseed.dev\`. This repository cannot provision, deploy, or check out Market or Market API.\n\n## Workspace\n\n\`trsd platform workset --plan --json\` reads the authenticated live team project inventory, observes exact repository refs, and previews assignment-owned custody. \`trsd platform workset --apply --yes --json\` materializes that disposable custody under \`packages/\`, \`templates/\`, and \`.fixtures/\`. The Platform Git repository contains no portfolio manifest or project gitlinks. Paired content repositories are logical TreeDX/R2 bindings and are never software workset checkouts.\n`;
}

function agentsGuide() {
	return `# Platform workspace guidance\n\nThis is the public TreeSeed installer and integration workspace. Preserve independent package builds and route infrastructure changes through SDK reconciliation and \`trsd\`. Never add Market or Market API as a checkout, submodule, provisionable project, or deployment resource. Hosted deployment remains fail-closed until the reviewed OpenTofu topology restores it.\n`;
}

function workflow() {
	return `name: Verify\n\non:\n  pull_request:\n  push:\n    branches: [main, staging]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\nconcurrency:\n  group: verify-\${{ github.repository }}-\${{ github.ref }}\n  cancel-in-progress: true\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n      - run: npm run verify\n`;
}

function boundaryVerifier() {
	return `import { existsSync, readFileSync } from 'node:fs';\nimport { resolve } from 'node:path';\n\nconst root = resolve(import.meta.dirname, '..');\nconst fail = (message) => { throw new Error(message); };\nif (existsSync(resolve(root, '.gitmodules'))) fail('Platform must not encode team inventory as gitlinks.');\nif (existsSync(resolve(root, 'treeseed.portfolio.json'))) fail('Platform must read live team inventory instead of a repository portfolio file.');\nconst config = readFileSync(resolve(root, 'treeseed.site.yaml'), 'utf8');\nconst requiredConfig = [/^\\s*kind: customer-platform\\s*$/mu, /^\\s*profile: treeseed\\s*$/mu, /^controlPlane: \\{ mode: managed \\}\\s*$/mu, /^processing: \\{ mode: local, providerRef: codex-sub \\}\\s*$/mu, /^\\s*api: \\{ enabled: true, provider: local \\}\\s*$/mu, /^\\s*treedx: \\{ enabled: true, provider: local \\}\\s*$/mu];\nif (requiredConfig.some((pattern) => !pattern.test(config))) fail('Platform configuration does not match the canonical local-managed Codex template.');\nif (/^\\s*market-?api:/imu.test(config)) fail('Platform configuration declares a forbidden Market API service.');\nconst seed = readFileSync(resolve(root, 'seeds/treeseed.yaml'), 'utf8');\nif (/^\\s+slug: market(?:-api)?\\s*$/mu.test(seed)) fail('Platform seed declares a Market project.');\nif (/information-hub/iu.test(seed)) fail('Platform seed contains a retired repository identity.');\nconsole.log(JSON.stringify({ ok: true, inventoryAuthority: 'api', gitlinks: 0, marketCheckouts: 0, authority: 'customer-platform', template: 'platform-local-managed-codex', hostedDeployment: false }));\n`;
}

export function normalizePlatformBoundaryVerifier(content: string) {
	return content
		.replace('^\\s*kind: customer-platform\\s*$', '^authority: \\{ kind: customer-platform \\}\\s*$')
		.replace('^\\s*profile: treeseed\\s*$', '^market: \\{ profile: treeseed \\}\\s*$');
}

export function platformConfigurationAssets(seedContent: string, sceneContent: string, templateIds: string[]): SnapshotFile[] {
	return [
		...templateIds.flatMap((id) => [
			{ path: `templates/${id}/template/seeds/platform.yaml`, content: seedContent },
			{ path: `templates/${id}/template/scenes/team-project-portfolio-demo.yaml`, content: sceneContent },
		]),
		{ path: 'scenes/team-project-portfolio-demo.yaml', content: sceneContent },
	];
}

async function baseFiles(projectRoot: string, sourceRef: string): Promise<SnapshotFile[]> {
	if (!/^[a-f0-9]{40}$/u.test(sourceRef)) throw new Error('Platform workspace source ref must be an exact 40-character commit SHA.');
	const copied = await Promise.all(copiedFiles.map(async (path) => {
		const observed = await git(projectRoot, ['show', `${sourceRef}:${path}`], { allowFailure: true, preserveOutput: true });
		if (observed.code !== 0) throw new Error(`Platform workspace source ${sourceRef} is missing ${path}.`);
		return { path, content: observed.stdout };
	}));
	const templatePaths = (await git(projectRoot, ['ls-tree', '-r', '--name-only', sourceRef, 'platform-templates'], { allowFailure: true })).stdout.split('\n').filter(Boolean);
	if (templatePaths.length === 0) throw new Error(`Platform workspace source ${sourceRef} has no canonical Platform templates.`);
	const templates = await Promise.all(templatePaths.map(async (sourcePath) => {
		const observed = await git(projectRoot, ['show', `${sourceRef}:${sourcePath}`], { preserveOutput: true });
		return { path: sourcePath.replace(/^platform-templates\//u, 'templates/'), content: observed.stdout };
	}));
	const seed = await git(projectRoot, ['show', `${sourceRef}:seeds/platform.yaml`], { preserveOutput: true });
	const scene = await git(projectRoot, ['show', `${sourceRef}:scenes/team-project-portfolio-demo.yaml`], { preserveOutput: true });
	const templateIds = templatePaths.filter((path) => path.endsWith('/template.config.json')).map((path) => path.split('/')[1]!).sort();
	const configurationAssets = platformConfigurationAssets(seed.stdout, scene.stdout, templateIds);
	return [
		...copied,
		...templates,
		...configurationAssets,
		{ path: '.github/workflows/verify.yml', content: workflow() },
		{ path: '.gitignore', content: 'node_modules/\n.treeseed/\ndist/\n/packages/\n/templates/*\n!/templates/platform-*/\n/.fixtures/\n' },
		{ path: 'AGENTS.md', content: agentsGuide() },
		{ path: 'README.md', content: readme() },
		{ path: 'package.json', content: platformPackage() },
		{ path: 'treeseed.site.yaml', content: platformDeployConfig() },
		{ path: 'scripts/verify-platform.mjs', content: normalizePlatformBoundaryVerifier(boundaryVerifier()) },
	];
}

async function linksForBranch(projectRoot: string, manifest: SeedManifest, branch: 'main' | 'staging', env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined) {
	const projects = manifest.resources.projects.filter((project) => project.slug !== 'platform' && project.repository.checkoutPath);
	const repositories = [
		...projects.map((project) => ({ path: project.repository.checkoutPath!, repository: `${project.repository.owner}/${project.repository.name}` })),
		...manifest.resources.hubRepositories.filter((repository) => repository.role === 'fixture').map((repository) => ({ path: repository.submodulePath ?? '.fixtures/treeseed-fixtures', repository: `${repository.owner}/${repository.name}` })),
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

export function classifyPlatformWorkspaceBranch(input: { sourceRef?: string; sourceDigest: string; targetCommit: string | null; receipt?: Partial<PlatformReceipt> | null }) {
	if (!input.targetCommit) return { action: 'create' as const, reason: 'Create the filtered Platform workspace snapshot.' };
	const journalOwnsTarget = input.receipt?.verified === true && input.receipt.targetCommit === input.targetCommit;
	if (!journalOwnsTarget) return { action: 'blocked' as const, reason: 'Target branch differs from the verified workspace journal or has no receipt.' };
	if (input.receipt?.sourceDigest === input.sourceDigest && (!input.sourceRef || input.receipt.sourceRef === input.sourceRef)) return { action: 'noop' as const, reason: 'Live target matches the verified workspace snapshot.' };
	return { action: 'update' as const, reason: 'Fast-forward the journal-owned target to the updated filtered snapshot.' };
}

export async function planPlatformWorkspace(input: { projectRoot: string; manifest: SeedManifest; targetBranch: WorkspaceBranch; sourceRef: string; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const project = platformProject(input.manifest);
	const targetRepository = `${project.repository.owner}/${project.repository.name}`;
	const credential = migrationCredential(input.projectRoot, targetRepository, input.env);
	if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${targetRepository}.`);
	const gitEnv = credentialEnvironment(credential.token);
	const observedSource = await remoteHead(input.projectRoot, 'treeseed-ai/market', input.targetBranch, gitEnv);
	if (observedSource !== input.sourceRef) throw new Error(`Market ${input.targetBranch} is ${observedSource ?? 'missing'}, not requested source ${input.sourceRef}.`);
	const files = await baseFiles(input.projectRoot, input.sourceRef);
	const journal = readJournal(input.projectRoot, targetRepository);
	const branches: PlatformWorkspacePlan['branches'] = [];
	for (const branch of [input.targetBranch]) {
		const links = await linksForBranch(input.projectRoot, input.manifest, branch, input.env);
		const sourceDigest = digest(files, links);
		const targetCommit = await remoteHead(input.projectRoot, targetRepository, branch, gitEnv);
		const receipt = journal?.receipts?.find((entry) => entry.branch === branch);
		branches.push({ branch, sourceDigest, targetCommit, links, ...classifyPlatformWorkspaceBranch({ sourceRef: input.sourceRef, sourceDigest, targetCommit, receipt }) });
	}
	return { project: 'platform', targetRepository, sourceRef: input.sourceRef, branches } satisfies PlatformWorkspacePlan;
}

async function buildCommit(repository: string, branch: string, files: SnapshotFile[], parent: string | null, gitEnv: NodeJS.ProcessEnv) {
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
		const tree = (await git(temporary, ['write-tree'], { env: indexEnv })).stdout;
		const commit = (await git(temporary, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `${parent ? 'Update' : 'Create'} Platform ${branch} integration workspace`], { env: { ...process.env, GIT_AUTHOR_NAME: 'TreeSeed migration', GIT_AUTHOR_EMAIL: 'operations@treeseed.dev', GIT_COMMITTER_NAME: 'TreeSeed migration', GIT_COMMITTER_EMAIL: 'operations@treeseed.dev' } })).stdout;
		await git(temporary, ['push', `https://github.com/${repository}.git`, `${commit}:refs/heads/${branch}`], { env: gitEnv });
		return commit;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

export async function applyPlatformWorkspace(input: { projectRoot: string; manifest: SeedManifest; targetBranch: WorkspaceBranch; sourceRef: string; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const plan = await planPlatformWorkspace(input);
	if (plan.branches.some((branch) => branch.action === 'blocked')) throw new Error(plan.branches.filter((branch) => branch.action === 'blocked').map((branch) => branch.reason).join(' '));
	const credential = migrationCredential(input.projectRoot, plan.targetRepository, input.env);
	const gitEnv = credentialEnvironment(credential.token!);
	const files = await baseFiles(input.projectRoot, input.sourceRef);
	const previousReceipts = readJournal(input.projectRoot, plan.targetRepository)?.receipts ?? [];
	const receipts: PlatformReceipt[] = [];
	for (const branch of plan.branches) {
		let commit = branch.targetCommit;
		if (branch.action === 'create' || branch.action === 'update') {
			commit = await buildCommit(plan.targetRepository, branch.branch, files, branch.action === 'update' ? branch.targetCommit : null, gitEnv);
		}
		const observed = await remoteHead(input.projectRoot, plan.targetRepository, branch.branch, gitEnv);
		if (!commit || observed !== commit) throw new Error(`Fresh GitHub read-back for ${plan.targetRepository}@${branch.branch} returned ${observed ?? 'missing'}, expected ${commit ?? 'missing'}.`);
		receipts.push({ branch: branch.branch, sourceRef: input.sourceRef, sourceDigest: branch.sourceDigest, targetCommit: observed, verified: true });
		writeJournal(input.projectRoot, plan, mergeReceipts(previousReceipts, receipts));
	}
	return { ...plan, status: 'history_verified' as const, receipts, journalPath: migrationJournalPath(input.projectRoot, plan.targetRepository) };
}
