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
import { KEY_AGENT_COMMAND_TIMEOUT_MS, LEGACY_MACHINE_KEY_RELATIVE_PATH, MACHINE_CONFIG_RELATIVE_PATH, MACHINE_KEY_HOME_RELATIVE_PATH, REMOTE_AUTH_RELATIVE_PATH, TREESEED_KEY_AGENT_AUTOPROMPT_ENV, WORKTREE_METADATA_RELATIVE_PATH, machineKeyHomeRootsByConfigRoot } from './machine-config-relative-path.ts';

export function loadTenantDeployConfig(tenantRoot) {
	try {
		return loadCliDeployConfig(tenantRoot);
	} catch (error) {
		const packageJsonPath = resolve(tenantRoot, 'package.json');
		if (!existsSync(packageJsonPath)) {
			throw error;
		}
		try {
			const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
			if (packageJson?.name !== '@treeseed/agent') {
				throw error;
			}
			const deployConfig = {
				name: 'TreeSeed Agent Capacity Provider',
				slug: 'treeseed-agent-capacity-provider',
				siteUrl: 'http://127.0.0.1:3100',
				contactEmail: 'hello@treeseed.ai',
				hosting: { kind: 'self_hosted_project', registration: 'none' },
				hub: { mode: 'treeseed_hosted' },
				runtime: { mode: 'byo_attached', registration: 'none' },
				surfaces: {
					web: { enabled: false },
					api: { enabled: true, provider: 'local', rootDir: '.', localBaseUrl: 'http://127.0.0.1:3100' },
				},
				services: {
					api: { enabled: true, provider: 'local', rootDir: '.' },
				},
				processing: { mode: 'local' },
				providers: {
					agents: {
						execution: 'codex',
						mutation: 'local_branch',
						repository: 'git',
						verification: 'local',
						notification: 'sdk_message',
						research: 'project_graph',
					},
				},
				plugins: [],
			};
			Object.defineProperty(deployConfig, '__tenantRoot', {
				value: tenantRoot,
				enumerable: false,
			});
			return deployConfig;
		} catch (fallbackError) {
			if (fallbackError === error) throw error;
			throw fallbackError;
		}
	}
}

export function loadOptionalTenantManifest(tenantRoot) {
	try {
		return withProcessCwd(tenantRoot, () => loadTreeseedManifest());
	} catch {
		return undefined;
	}
}

export function findNearestTreeseedMachineConfig(startRoot = process.cwd()) {
	let current = resolve(startRoot);

	while (true) {
		const configPath = resolve(current, MACHINE_CONFIG_RELATIVE_PATH);
		if (existsSync(configPath)) {
			return configPath;
		}

		const parent = resolve(current, '..');
		if (parent === current) {
			break;
		}
		current = parent;
	}

	return null;
}

export function getTreeseedMachineConfigPaths(tenantRoot) {
	const configRoot = resolveManagedWorktreeMachineConfigRoot(tenantRoot);
	const defaultHomeRoot = process.env.VITEST === 'true'
		? configRoot
		: process.env.HOME && process.env.HOME.trim().length > 0 ? process.env.HOME : homedir();
	const homeRoot = machineKeyHomeRootsByConfigRoot.get(configRoot) ?? defaultHomeRoot;
	machineKeyHomeRootsByConfigRoot.set(configRoot, homeRoot);
	return {
		configPath: resolve(configRoot, MACHINE_CONFIG_RELATIVE_PATH),
		authPath: resolve(configRoot, REMOTE_AUTH_RELATIVE_PATH),
		keyPath: resolve(homeRoot, MACHINE_KEY_HOME_RELATIVE_PATH),
		legacyKeyPath: resolve(configRoot, LEGACY_MACHINE_KEY_RELATIVE_PATH),
	};
}

export function resolveManagedWorktreeMachineConfigRoot(tenantRoot) {
	if (existsSync(resolve(tenantRoot, MACHINE_CONFIG_RELATIVE_PATH))) {
		return tenantRoot;
	}
	const metadataPath = resolve(tenantRoot, WORKTREE_METADATA_RELATIVE_PATH);
	if (!existsSync(metadataPath)) return tenantRoot;
	try {
		const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) ?? {};
		const primaryRoot = metadata.kind === 'treeseed.workflow.worktree' && typeof metadata.primaryRoot === 'string'
			? metadata.primaryRoot
			: null;
		return primaryRoot && existsSync(resolve(primaryRoot, MACHINE_CONFIG_RELATIVE_PATH))
			? primaryRoot
			: tenantRoot;
	} catch {
		return tenantRoot;
	}
}

export function keyAgentScriptPath() {
	const distScriptPath = resolve(packageDistScriptRoot, 'key-agent.js');
	return existsSync(distScriptPath) ? distScriptPath : packageScriptPath('key-agent.ts');
}

export function keyAgentNodeArgs() {
	const scriptPath = keyAgentScriptPath();
	return scriptPath.endsWith('.ts')
		? ['--import', 'tsx', scriptPath]
		: [scriptPath];
}

export function keyAgentScriptCwd() {
	return dirname(dirname(keyAgentScriptPath()));
}

export function sleepMs(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function shellQuote(value: string) {
	return `'${value.replace(/'/gu, `'\\''`)}'`;
}

export function keyAgentAutoPromptEnabled() {
	const value = String(process.env[TREESEED_KEY_AGENT_AUTOPROMPT_ENV] ?? '').trim().toLowerCase();
	if (value === '0' || value === 'false' || value === 'off') {
		return false;
	}
	return process.stdin.isTTY && process.stdout.isTTY;
}

export function useInlineKeyAgentTransport() {
	return process.env.VITEST === 'true' || process.env.TREESEED_KEY_AGENT_TRANSPORT === 'inline';
}

export function withTreeseedKeyAgentAutopromptDisabled<T>(action: () => T): T {
	const previous = process.env[TREESEED_KEY_AGENT_AUTOPROMPT_ENV];
	process.env[TREESEED_KEY_AGENT_AUTOPROMPT_ENV] = '0';
	try {
		return action();
	} finally {
		if (previous === undefined) {
			delete process.env[TREESEED_KEY_AGENT_AUTOPROMPT_ENV];
		} else {
			process.env[TREESEED_KEY_AGENT_AUTOPROMPT_ENV] = previous;
		}
	}
}

export function startTreeseedKeyAgentDaemon(tenantRoot) {
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const { socketPath } = getTreeseedKeyAgentPaths();
	const scriptArgs = keyAgentNodeArgs();
	const command = [
		shellQuote(process.execPath),
		...scriptArgs.map((arg) => shellQuote(arg)),
		'serve',
		'--key-path',
		shellQuote(keyPath),
		'--socket-path',
		shellQuote(socketPath),
		'--idle-timeout-ms',
		shellQuote(String(TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS)),
		'>/dev/null',
		'2>/dev/null',
		'&',
	].join(' ');
	const child = spawn('bash', ['-lc', command], {
		cwd: keyAgentScriptCwd(),
		stdio: 'ignore',
	});
	child.unref();
}

export function runTreeseedKeyAgentCommand(args, options = {}) {
	const result = spawnSync(process.execPath, [
		...keyAgentNodeArgs(),
		...args,
	], {
		cwd: keyAgentScriptCwd(),
		encoding: 'utf8',
		env: {
			...process.env,
			...(options.env ?? {}),
		},
		stdio: options.input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
		input: options.input,
		timeout: KEY_AGENT_COMMAND_TIMEOUT_MS,
		killSignal: 'SIGTERM',
	});
	if (result.error) {
		const timedOut = result.error.code === 'ETIMEDOUT';
		return {
			ok: false,
			code: 'daemon_unavailable',
			message: timedOut
				? `Treeseed key-agent command timed out after ${KEY_AGENT_COMMAND_TIMEOUT_MS}ms.`
				: result.error.message || 'Treeseed key-agent command failed.',
		};
	}
	if (result.status !== 0 && (!result.stdout || result.stdout.trim().length === 0)) {
		return {
			ok: false,
			code: 'daemon_unavailable',
			message: result.stderr?.trim() || 'Treeseed key-agent command failed.',
		};
	}
	try {
		return JSON.parse(result.stdout.trim() || '{}');
	} catch {
		throw new TreeseedKeyAgentError(
			'daemon_unavailable',
			result.stderr?.trim() || 'Treeseed key-agent command returned an invalid response.',
		);
	}
}

export function requestTreeseedKeyAgent(tenantRoot, payload, { ensureRunning = false, env } = {}) {
	const invoke = () => runTreeseedKeyAgentCommand([
		'request',
		JSON.stringify(payload),
	], { env });
	let response = invoke();
	if (response.code !== 'daemon_unavailable' || !ensureRunning) {
		return response;
	}
	startTreeseedKeyAgentDaemon(tenantRoot);
	for (let attempt = 0; attempt < 20; attempt += 1) {
		response = invoke();
		if (response.code !== 'daemon_unavailable') {
			return response;
		}
		sleepMs(25);
	}
	return response;
}
