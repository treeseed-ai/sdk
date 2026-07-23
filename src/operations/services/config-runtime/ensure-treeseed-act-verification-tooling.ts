import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ApiPrincipal, RemoteTreeseedConfig, RemoteTreeseedHost } from '../../../remote.ts';
import {
	getTreeseedEnvironmentSuggestedValues,
	isTreeseedEnvironmentEntryRelevant,
	isTreeseedEnvironmentEntryRequired,
	resolveTreeseedEnvironmentRegistry,
	TREESEED_ENVIRONMENT_SCOPES,
	type TreeseedEnvironmentPurpose,
	type TreeseedEnvironmentValidation,
	validateTreeseedEnvironmentValues,
} from '../../../platform/environment.ts';
import { loadTreeseedManifest } from '../../../platform/tenant-config.ts';
import {
	buildProvisioningSummary,
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
	loadDeployState,
	provisionCloudflareResources,
	syncCloudflareSecrets,
	verifyProvisionedCloudflareResources,
} from '../deploy.ts';
import {
	collectTreeseedReconcileStatus,
	reconcileTreeseedTarget,
	resolveTreeseedBootstrapSelection,
	type TreeseedBootstrapSystem,
	type TreeseedDesiredUnit,
	type TreeseedRunnableBootstrapSystem,
} from '../../../reconcile/index.ts';
import {
	ensureGitHubBootstrapRepository,
	maybeResolveGitHubRepositorySlug,
} from '../github-automation.ts';
import {
	buildRailwayCommandEnv,
	configuredRailwayServices,
	validateRailwayDeployPrerequisites,
} from '../railway-deploy.ts';
import {
	ensureRailwayEnvironment,
	ensureRailwayProject,
	ensureRailwayService,
	normalizeRailwayEnvironmentName,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
	upsertRailwayVariables,
} from '../railway-api.ts';
import { discoverTreeseedApplications } from '../../../hosting/apps.ts';
import {
	createGitHubApiClient,
	ensureGitHubBranchFromBase,
	listGitHubEnvironmentSecretNames,
	listGitHubEnvironmentVariableNames,
} from '../github-api.ts';
import { resolveGitHubCredentialForRepository } from '../github-credentials.ts';
import { loadCliDeployConfig, packageDistScriptRoot, packageScriptPath, resolveWranglerBin, withProcessCwd } from '../runtime-tools.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from '../git-workflow.ts';
import {
	createTreeseedManagedToolEnv,
	resolveTreeseedToolBinary,
	resolveTreeseedToolCommand,
} from '../../../managed-dependencies.ts';
import { TREESEED_GITHUB_TOKEN_ENV, resolveTreeseedGitHubToken, withTreeseedServiceCredentialEnv } from '../../../service-credentials.ts';
import {
	filterManagedHostGitHubEnvironment,
	usesManagedHostOperationRequests,
} from '../managed-host-security.ts';
import {
	assertTreeseedKeyAgentResponse,
	getTreeseedKeyAgentPaths,
	inspectTreeseedKeyAgentDiagnostics,
	readWrappedMachineKeyFile,
	replaceWrappedMachineKey,
	rotateWrappedMachineKeyPassphrase,
	TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	TreeseedKeyAgentError,
	unwrapMachineKey,
	type TreeseedKeyAgentStatus,
} from '../key-agent.ts';
import { checkCommand, commandAvailable, toolStatus } from './resolve-treeseed-launch-environment.ts';
import { CLI_CHECK_TIMEOUT_MS } from './machine-config-relative-path.ts';

export function ensureTreeseedActVerificationTooling({ tenantRoot = process.cwd(), installIfMissing = true, env = process.env, write } = {}) {
	const managedEnv = createTreeseedManagedToolEnv(env);
	const ghBinary = resolveTreeseedToolBinary('gh', { env: managedEnv });
	const githubCli = !ghBinary
		? toolStatus('githubCli', false, 'GitHub CLI `gh` is not installed.')
		: (() => {
			const check = checkCommand(ghBinary, ['--version'], { cwd: tenantRoot, env: managedEnv });
			return toolStatus('githubCli', check.ok, check.ok ? check.stdout.split('\n')[0] ?? 'GitHub CLI detected.' : (check.detail || 'GitHub CLI check failed.'));
		})();

	let ghActExtension = toolStatus('ghActExtension', false, 'GitHub CLI extension `gh-act` is not installed.', {
		attemptedInstall: false,
		installedDuringConfig: false,
	});
	const wranglerCli = (() => {
		try {
			const wranglerCheck = checkCommand(process.execPath, [resolveWranglerBin(), '--version'], { cwd: tenantRoot, env });
			return toolStatus(
				'wranglerCli',
				wranglerCheck.ok,
				wranglerCheck.ok
					? wranglerCheck.stdout.split('\n')[0] ?? 'Wrangler CLI detected.'
					: wranglerCheck.detail || 'Wrangler CLI is unavailable.',
			);
		} catch (error) {
			return toolStatus(
				'wranglerCli',
				false,
				error instanceof Error && error.message
					? error.message
					: 'Wrangler CLI is unavailable.',
			);
		}
	})();
	const railwayCommand = resolveTreeseedToolCommand('railway', { env });
	const railwayCheck = railwayCommand
		? checkCommand(railwayCommand.command, [...railwayCommand.argsPrefix, '--version'], { cwd: tenantRoot, env })
		: { ok: false, stdout: '', detail: 'Railway CLI is unavailable.' };
	const railwayCli = toolStatus(
		'railwayCli',
		railwayCheck.ok,
		railwayCheck.ok
			? railwayCheck.stdout.split('\n')[0] ?? 'Railway CLI detected.'
			: railwayCheck.detail || 'Railway CLI is unavailable.',
	);

	if (githubCli.available && ghBinary) {
		const check = checkCommand(ghBinary, ['act', '--version'], { cwd: tenantRoot, env: managedEnv });
		if (check.ok) {
			ghActExtension = toolStatus('ghActExtension', true, check.stdout.split('\n')[0] ?? 'gh-act is installed.', {
				attemptedInstall: false,
				installedDuringConfig: false,
			});
		} else if (installIfMissing && commandAvailable('docker')) {
			write?.('Installing GitHub CLI extension `gh-act`...');
			const install = checkCommand(ghBinary, ['extension', 'install', 'https://github.com/nektos/gh-act'], { cwd: tenantRoot, env: managedEnv });
			const postInstall = checkCommand(ghBinary, ['act', '--version'], { cwd: tenantRoot, env: managedEnv });
			ghActExtension = toolStatus(
				'ghActExtension',
				postInstall.ok,
				postInstall.ok
					? postInstall.stdout.split('\n')[0] ?? 'gh-act is installed.'
					: install.detail || postInstall.detail || 'Unable to install the gh-act extension.',
				{
					attemptedInstall: true,
					installedDuringConfig: postInstall.ok,
					installStatus: install.status,
				},
			);
		} else if (installIfMissing) {
			ghActExtension = toolStatus('ghActExtension', false, 'Docker is not on PATH, so gh-act installation was skipped.', {
				attemptedInstall: false,
				installedDuringConfig: false,
			});
		} else {
			ghActExtension = toolStatus('ghActExtension', false, check.detail || 'GitHub CLI extension `gh-act` is not installed.', {
				attemptedInstall: false,
				installedDuringConfig: false,
			});
		}
	}

	const dockerCheck = checkCommand('docker', ['info'], { cwd: tenantRoot, env });
	const dockerDaemon = toolStatus(
		'dockerDaemon',
		dockerCheck.ok,
		dockerCheck.ok
			? dockerCheck.stdout.split('\n')[0] ?? 'Docker daemon is available.'
			: dockerCheck.detail || 'Docker daemon is unavailable.',
	);

	const remediation = [];
	if (!githubCli.available) {
		remediation.push('Install GitHub CLI from https://cli.github.com/ and rerun `treeseed config`.');
	}
	if (githubCli.available && !ghActExtension.available) {
		remediation.push('Run `gh extension install https://github.com/nektos/gh-act` and rerun `treeseed config`.');
	}
	if (!dockerDaemon.available) {
		remediation.push('Start Docker Desktop or another local Docker daemon, then rerun `treeseed config`.');
	}
	if (!wranglerCli.available) {
		remediation.push('Install Wrangler or ensure the packaged Wrangler dependency is runnable, then rerun `treeseed config`.');
	}
	if (!railwayCli.available) {
		remediation.push('Install Railway CLI if you plan to manage Railway services from this machine.');
	}

	return {
		githubCli,
		ghActExtension,
		dockerDaemon,
		wranglerCli,
		railwayCli,
		actVerificationReady: githubCli.available && ghActExtension.available && dockerDaemon.available,
		remediation,
	};
}

export function formatCheckOutput(result) {
	return `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim();
}

export function providerConnectionResult(provider, ready, detail, extra = {}) {
	return {
		provider,
		ready,
		detail,
		...extra,
	};
}

export function isTransientProviderConnectionError(detail) {
	return /fetch failed|failed to fetch|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|api check failed|rate.?limit|too many requests|429/iu.test(detail || '');
}

export function checkGitHubConnection({ tenantRoot, env }) {
	const identityMode = env.TREESEED_GITHUB_IDENTITY_MODE === 'account' ? 'account' : 'repository';
	const repository = identityMode === 'repository' ? maybeResolveGitHubRepositorySlug(tenantRoot) : null;
	const credential = repository
		? resolveGitHubCredentialForRepository(repository, { values: env, env })
		: null;
	const token = credential?.token ?? resolveTreeseedGitHubToken(env);
	if (!token) {
		return providerConnectionResult(
			'github',
			false,
			credential
				? `${credential.envName} or TREESEED_GITHUB_TOKEN is not configured.`
				: 'TREESEED_GITHUB_TOKEN is not configured.',
			{ skipped: true },
		);
	}
	const gh = resolveTreeseedToolBinary('gh', { env });
	if (!gh) {
		return providerConnectionResult('github', false, 'GitHub CLI `gh` is not installed.');
	}
	const owner = typeof env.TREESEED_HOSTED_HUBS_GITHUB_OWNER === 'string'
		? env.TREESEED_HOSTED_HUBS_GITHUB_OWNER.trim()
		: '';
	const toolEnv = createTreeseedManagedToolEnv({ ...process.env, ...env, TREESEED_GITHUB_TOKEN: token });
	const commandCandidates = repository
		? [{
			args: ['repo', 'view', repository, '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
			successMessage: (resolved: string) => `GitHub token can access ${resolved || repository}.`,
		}]
		: owner
			? [
				{
					args: ['api', `orgs/${owner}`, '--jq', '.login'],
					successMessage: (resolved: string) => `GitHub token can access organization ${resolved || owner}.`,
					optional: true,
				},
				{
					args: ['api', `users/${owner}`, '--jq', '.login'],
					successMessage: (resolved: string) => `GitHub token can access user ${resolved || owner}.`,
					optional: true,
				},
			]
			: [
			{
				args: ['api', 'user', '--jq', '.login'],
				successMessage: (resolved: string) => resolved ? `Authenticated as ${resolved}.` : 'GitHub API check succeeded.',
			},
		];
	let lastDetail = '';
	for (let attempt = 0; attempt < 3; attempt += 1) {
		for (const candidate of commandCandidates) {
			const result = spawnSync(gh, candidate.args, {
				cwd: tenantRoot,
				stdio: 'pipe',
				encoding: 'utf8',
				env: toolEnv,
				timeout: CLI_CHECK_TIMEOUT_MS,
			});
			if (result.status === 0) {
				return providerConnectionResult('github', true, candidate.successMessage(result.stdout.trim()));
			}
			lastDetail = formatCheckOutput(result) || 'GitHub API check failed.';
			if (candidate.optional && !isTransientProviderConnectionError(lastDetail)) {
				continue;
			}
			break;
		}
		if (attempt >= 2 || !isTransientProviderConnectionError(lastDetail)) {
			return providerConnectionResult('github', false, lastDetail || 'GitHub API check failed.');
		}
	}
	return providerConnectionResult('github', false, lastDetail || 'GitHub API check failed.');
}

export function checkCloudflareConnection({ tenantRoot, env }) {
	if (!env.TREESEED_CLOUDFLARE_API_TOKEN) {
		return providerConnectionResult('cloudflare', false, 'TREESEED_CLOUDFLARE_API_TOKEN is not configured.', { skipped: true });
	}
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const result = spawnSync(process.execPath, [resolveWranglerBin(), 'whoami'], {
				cwd: tenantRoot,
				stdio: 'pipe',
				encoding: 'utf8',
				env: createTreeseedManagedToolEnv({ ...process.env, ...env }),
				timeout: CLI_CHECK_TIMEOUT_MS,
			});
			if (result.status === 0) {
				return providerConnectionResult('cloudflare', true, 'Wrangler authenticated with TREESEED_CLOUDFLARE_API_TOKEN.');
			}
			const detail = formatCheckOutput(result) || 'Cloudflare Wrangler check failed.';
			if (attempt >= 2 || !isTransientProviderConnectionError(detail)) {
				return providerConnectionResult('cloudflare', false, detail);
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : 'Cloudflare Wrangler check failed.';
			if (attempt >= 2 || !isTransientProviderConnectionError(detail)) {
				return providerConnectionResult('cloudflare', false, detail);
			}
		}
	}
	return providerConnectionResult(
		'cloudflare',
		false,
		'Cloudflare connectivity preflight hit transient fetch failures; bootstrap will continue and rely on live reconcile verification.',
		{ skipped: true, warning: true, transient: true },
	);
}
