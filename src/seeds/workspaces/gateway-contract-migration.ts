import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { credentialEnvironment, git, migrationCredential, remoteHead } from '../repositories/repository-history.js';
import type { SeedManifest } from '../types.js';

export const gatewayContractPaths = [
	'package-lock.json',
	'package.json',
	'src/entrypoints/clients/market-client.ts',
	'src/gateway/admin-passthrough.ts',
	'src/gateway/admin-route-inventory.ts',
	'src/gateway/header-policy.ts',
	'src/gateway/health.ts',
	'src/gateway/index.ts',
	'src/gateway/node-websocket-proxy.ts',
	'src/index/platform-and-hosting.ts',
	'src/index/public-contracts.ts',
	'src/market-client/support/preferences/request.ts',
	'src/operations/services/configuration/github-credentials.ts',
	'src/operations/services/git-runner/git-runner-mode.ts',
	'src/operations/services/github-api/create-git-hub-api-client.ts',
	'src/operations/services/github-api/require.ts',
	'src/platform/deploy-config/parse-deploy-config.ts',
	'src/platform/deploy-config/parse-platform-connections.ts',
	'src/platform/env.yaml',
	'src/platform/environment/resolve-content-bucket-binding.ts',
	'src/platform/support/contracts.ts',
	'src/reconcile/builtin-adapters/repositories/build-github-branch-adapter.ts',
	'src/reconcile/builtin-adapters/repositories/build-github-branch-rules-adapter.ts',
	'src/reconcile/builtin-adapters/repositories/build-github-repository-adapter.ts',
	'src/reconcile/builtin-adapters/repositories/build-github-workflow-observation-adapter.ts',
	'src/reconcile/builtin-adapters/capacity/providers/capacity-provider-variables-for-service.ts',
	'src/reconcile/builtin-adapters/treedx/graph/build-graph-only-adapter.ts',
	'src/reconcile/providers/github-private.ts',
	'src/reconcile/repositories/live-acceptance-github-client.ts',
	'src/reconcile/repositories/live-acceptance-github.ts',
	'src/reconcile/runtime/live-acceptance-runtime.ts',
	'src/reconcile/support/acceptance/live-acceptance-starter-engineering.ts',
	'src/reconcile/support/acceptance/live-acceptance-starter-planning.ts',
	'src/reconcile/support/acceptance/live-acceptance.ts',
	'src/reconcile/support/contracts/contracts.ts',
	'guarantees/project/repository-migration/separate-software-and-content-repositories.guarantee.yaml',
	'tests/integration/misc/testing/export-runtime.test.ts',
	'tests/integration/misc/accounts/remote.sends-the-remote-contract-header-and-bearer-auth.test.ts',
	'tests/integration/config/configuration/config-github-sync.test.ts',
	'tests/integration/config/hosting/deploy-config-planes.test.ts',
	'tests/integration/repository/reconciliation/github-private-reconcile.test.ts',
	'tests/integration/repository/repositories/repository-alias-state.test.ts',
	'tests/contract/misc/package-graph.test.ts',
	'tests/contract/repository/git-runner-boundary.test.ts',
	'tests/unit/config/configuration/github-credentials.test.ts',
	'tests/unit/config/commerce/catalog/environment-registry.registers-staging-and-production-market-defaults-for-primary-and-integrated-catalog-markets.test.ts',
	'tests/unit/gateway/admin-passthrough.test.ts',
	'tests/unit/gateway/health.test.ts',
	'tests/unit/gateway/node-websocket-proxy.test.ts',
	'tests/unit/reconcile/capacity-provider-control-plane-variables.test.ts',
	'tests/unit/misc/seeds/repository-policy.test.ts',
	'tests/unit/misc/testing/market-client.test.ts',
	'tests/unit/reconcile/github-live-repository.test.ts',
	'tests/unit/reconciliation/repositories/github-repository-adapter.test.ts',
];

const cliPaths = [
	'package-lock.json',
	'package.json',
	'scripts/packages/release-verify.ts',
	'src/cli/handlers/accounts/auth-login.ts',
	'src/cli/handlers/seeds/seed-repositories.ts',
	'src/cli/handlers/seeds/seed.ts',
	'src/cli/seeds/operations-seed-and-demo.ts',
	'tests/support/help-harness.ts',
	'tests/support/seed-command-harness.ts',
];

function filesUnder(root: string, relativeDirectory: string): string[] {
	const directory = resolve(root, relativeDirectory);
	return readdirSync(directory).flatMap((entry) => {
		const relativePath = `${relativeDirectory}/${entry}`;
		return statSync(resolve(root, relativePath)).isDirectory() ? filesUnder(root, relativePath) : [relativePath];
	});
}

async function withFetched<T>(repository: string, gitEnv: NodeJS.ProcessEnv, operation: (root: string, commit: string) => Promise<T>) {
	const temporary = mkdtempSync(resolve(tmpdir(), 'trsd-gateway-contract-'));
	try {
		await git(temporary, ['init', '--quiet']);
		await git(temporary, ['fetch', '--quiet', '--no-tags', `https://github.com/${repository}.git`, 'refs/heads/staging'], { env: gitEnv });
		return await operation(temporary, (await git(temporary, ['rev-parse', 'FETCH_HEAD'])).stdout);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

function projectBySlug(manifest: SeedManifest, slug: string) {
	const project = manifest.resources.projects.find((entry) => entry.slug === slug);
	if (!project) throw new Error(`Seed ${manifest.name} does not declare ${slug}.`);
	return project;
}

function desiredFiles(projectRoot: string) {
	const packageRoot = resolve(projectRoot, 'packages/sdk');
	const paths = [...new Set([...gatewayContractPaths, ...filesUnder(packageRoot, 'src/seeds'), ...filesUnder(packageRoot, 'tests/unit/seeds')])].sort();
	return paths.map((path) => ({ path, content: readFileSync(resolve(packageRoot, path), 'utf8') }));
}

function pinSdkRef(content: string, sdkRef: string) {
	return content
		.replace(/github:treeseed-ai\/sdk#[a-f0-9]{40}/gu, `github:treeseed-ai/sdk#${sdkRef}`)
		.replace(/git\+ssh:\/\/git@github\.com\/treeseed-ai\/sdk\.git#[a-f0-9]{40}/gu, `git+ssh://git@github.com/treeseed-ai/sdk.git#${sdkRef}`)
		.replace(/git\+https:\/\/github\.com\/treeseed-ai\/sdk\.git#[a-f0-9]{40}/gu, `git+https://github.com/treeseed-ai/sdk.git#${sdkRef}`);
}

function desiredCliFiles(projectRoot: string, sdkRef: string) {
	const packageRoot = resolve(projectRoot, 'packages/cli');
	const paths = [...new Set([...cliPaths, ...filesUnder(packageRoot, 'src/cli/handlers/seeds/migrations')])].sort();
	return paths.map((path) => ({ path, content: pinSdkRef(readFileSync(resolve(packageRoot, path), 'utf8'), sdkRef) }));
}

async function matches(root: string, commit: string, files: ReturnType<typeof desiredFiles>) {
	for (const file of files) {
		const observed = await git(root, ['show', `${commit}:${file.path}`], { allowFailure: true, preserveOutput: true });
		if (observed.code !== 0 || observed.stdout !== file.content) return false;
	}
	return true;
}

async function applyOverlay(input: { repository: string; sourceCommit: string; files: ReturnType<typeof desiredFiles>; gitEnv: NodeJS.ProcessEnv; message: string }) {
	return withFetched(input.repository, input.gitEnv, async (root, fetchedCommit) => {
		if (fetchedCommit !== input.sourceCommit) throw new Error(`Stale migration plan for ${input.repository}.`);
		if (await matches(root, fetchedCommit, input.files)) return fetchedCommit;
		const indexPath = resolve(root, 'migration-index');
		const indexEnv = { ...process.env, GIT_INDEX_FILE: indexPath };
		await git(root, ['read-tree', fetchedCommit], { env: indexEnv });
		for (const file of input.files) {
			const blob = (await git(root, ['hash-object', '-w', '--stdin'], { input: file.content })).stdout;
			await git(root, ['update-index', '--add', '--cacheinfo', '100644', blob, file.path], { env: indexEnv });
		}
		const tree = (await git(root, ['write-tree'], { env: indexEnv })).stdout;
		const commit = (await git(root, ['commit-tree', tree, '-p', fetchedCommit, '-m', input.message], { env: { ...process.env, GIT_AUTHOR_NAME: 'TreeSeed migration', GIT_AUTHOR_EMAIL: 'operations@treeseed.dev', GIT_COMMITTER_NAME: 'TreeSeed migration', GIT_COMMITTER_EMAIL: 'operations@treeseed.dev' } })).stdout;
		await git(root, ['push', `https://github.com/${input.repository}.git`, `${commit}:refs/heads/staging`], { env: input.gitEnv });
		return commit;
	});
}

export async function planGatewayContractMigration(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const project = projectBySlug(input.manifest, 'sdk');
	const cliProject = projectBySlug(input.manifest, 'cli');
	const repository = `${project.repository.owner}/${project.repository.name}`;
	const cliRepository = `${cliProject.repository.owner}/${cliProject.repository.name}`;
	const credential = migrationCredential(input.projectRoot, repository, input.env);
	const cliCredential = migrationCredential(input.projectRoot, cliRepository, input.env);
	if (!credential.token) throw new Error(`Central GitHub credential ${credential.envName} is required for ${repository}.`);
	if (!cliCredential.token) throw new Error(`Central GitHub credential ${cliCredential.envName} is required for ${cliRepository}.`);
	const gitEnv = credentialEnvironment(credential.token);
	return withFetched(repository, gitEnv, async (root, sourceCommit) => {
		const sdkCurrent = await matches(root, sourceCommit, desiredFiles(input.projectRoot));
		return withFetched(cliRepository, credentialEnvironment(cliCredential.token!), async (cliRoot, cliSourceCommit) => {
			const cliCurrent = sdkCurrent && await matches(cliRoot, cliSourceCommit, desiredCliFiles(input.projectRoot, sourceCommit));
			const current = sdkCurrent && cliCurrent;
			return { repository, cliRepository, branch: 'staging' as const, sourceCommit, cliSourceCommit, action: current ? 'noop' as const : 'update' as const, reason: current ? 'Live SDK and CLI expose the verified repository migration toolchain.' : 'Fast-forward bounded SDK and CLI migration tooling on staging.' };
		});
	});
}

export async function applyGatewayContractMigration(input: { projectRoot: string; manifest: SeedManifest; env?: NodeJS.ProcessEnv | Record<string, string | undefined> }) {
	const plan = await planGatewayContractMigration(input);
	const credential = migrationCredential(input.projectRoot, plan.repository, input.env);
	const cliCredential = migrationCredential(input.projectRoot, plan.cliRepository, input.env);
	const gitEnv = credentialEnvironment(credential.token!);
	const targetCommit = await applyOverlay({ repository: plan.repository, sourceCommit: plan.sourceCommit, files: desiredFiles(input.projectRoot), gitEnv, message: 'Publish repository migration reconciliation toolchain' });
	const observed = await remoteHead(input.projectRoot, plan.repository, 'staging', gitEnv);
	if (observed !== targetCommit) throw new Error(`Fresh GitHub read-back returned ${observed ?? 'missing'}, expected ${targetCommit}.`);
	const cliGitEnv = credentialEnvironment(cliCredential.token!);
	const cliTargetCommit = await applyOverlay({ repository: plan.cliRepository, sourceCommit: plan.cliSourceCommit, files: desiredCliFiles(input.projectRoot, targetCommit), gitEnv: cliGitEnv, message: 'Publish repository migration CLI workflows' });
	const cliObserved = await remoteHead(input.projectRoot, plan.cliRepository, 'staging', cliGitEnv);
	if (cliObserved !== cliTargetCommit) throw new Error(`Fresh GitHub read-back returned ${cliObserved ?? 'missing'}, expected ${cliTargetCommit}.`);
	return { ...plan, targetCommit, cliTargetCommit, status: 'verified' as const };
}
