import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ApiPrincipal, RemoteTreeseedConfig, RemoteTreeseedHost } from '../../remote.ts';
import {
	getTreeseedEnvironmentSuggestedValues,
	isTreeseedEnvironmentEntryRelevant,
	isTreeseedEnvironmentEntryRequired,
	resolveTreeseedEnvironmentRegistry,
	TREESEED_ENVIRONMENT_SCOPES,
	type TreeseedEnvironmentPurpose,
	type TreeseedEnvironmentValidation,
	validateTreeseedEnvironmentValues,
} from '../../platform/environment.ts';
import { loadTreeseedManifest } from '../../platform/tenant-config.ts';
import {
	buildProvisioningSummary,
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
	loadDeployState,
	provisionCloudflareResources,
	syncCloudflareSecrets,
	verifyProvisionedCloudflareResources,
} from './deploy.ts';
import {
	collectTreeseedReconcileStatus,
	reconcileTreeseedTarget,
	resolveTreeseedBootstrapSelection,
	type TreeseedBootstrapSystem,
	type TreeseedRunnableBootstrapSystem,
} from '../../reconcile/index.ts';
import {
	ensureGitHubBootstrapRepository,
	maybeResolveGitHubRepositorySlug,
} from './github-automation.ts';
import {
	buildRailwayCommandEnv,
	configuredRailwayServices,
	validateRailwayDeployPrerequisites,
} from './railway-deploy.ts';
import {
	normalizeRailwayEnvironmentName,
	resolveRailwayWorkspace,
} from './railway-api.ts';
import {
	createGitHubApiClient,
	ensureGitHubActionsEnvironment,
	ensureGitHubBranchFromBase,
	listGitHubEnvironmentSecretNames,
	listGitHubEnvironmentVariableNames,
	upsertGitHubEnvironmentSecret,
	upsertGitHubEnvironmentVariable,
} from './github-api.ts';
import { loadCliDeployConfig, packageScriptPath, resolveWranglerBin, withProcessCwd } from './runtime-tools.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from './git-workflow.ts';
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
} from './key-agent.ts';

export { TREESEED_MACHINE_KEY_PASSPHRASE_ENV, TreeseedKeyAgentError } from './key-agent.ts';

const MACHINE_CONFIG_RELATIVE_PATH = '.treeseed/config/machine.yaml';
const MACHINE_KEY_HOME_RELATIVE_PATH = '.treeseed/config/machine.key';
const LEGACY_MACHINE_KEY_RELATIVE_PATH = '.treeseed/config/machine.key';
const REMOTE_AUTH_RELATIVE_PATH = '.treeseed/config/remote-auth.json';
const TEMPLATE_CATALOG_CACHE_RELATIVE_PATH = 'treeseed/cache/template-catalog.json';
const TENANT_ENVIRONMENT_OVERLAY_PATH = 'src/env.yaml';
const CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER = 'replace-with-cloudflare-account-id';
const TREESEED_KEY_AGENT_AUTOPROMPT_ENV = 'TREESEED_KEY_AGENT_AUTOPROMPT';
export const DEFAULT_TREESEED_API_BASE_URL = 'https://api.treeseed.ai';
export const DEFAULT_TEMPLATE_CATALOG_URL = 'https://api.treeseed.ai/search/templates';
export const TREESEED_TEMPLATE_CATALOG_URL_ENV = 'TREESEED_TEMPLATE_CATALOG_URL';
export const TREESEED_API_BASE_URL_ENV = 'TREESEED_API_BASE_URL';
const CLI_CHECK_TIMEOUT_MS = 5000;
const DEPRECATED_LOCAL_ENV_FILES = ['.env.local', '.dev.vars'] as const;
const warnedDeprecatedLocalEnvRoots = new Set<string>();
const inlineTreeseedSecretSessions = new Map<string, { machineKey: Buffer | null; lastTouchedAt: number; idleTimeoutMs: number }>();
const railwayConnectionCheckCache = new Map<string, Promise<ReturnType<typeof providerConnectionResult>>>();

function filterEnvironmentValuesByRegistry(
	values,
	registry,
	scope: TreeseedConfigScope,
	purpose: TreeseedEnvironmentPurpose = 'config',
) {
	const registeredKeys = new Set(registry.entries
		.filter((entry) => isTreeseedEnvironmentEntryRelevant(entry, registry.context, scope, purpose))
		.map((entry) => entry.id));
	return Object.fromEntries(
		Object.entries(values).filter(([key]) => registeredKeys.has(key)),
	);
}

export function inspectTreeseedPassphraseEnvDiagnostic(env: NodeJS.ProcessEnv = process.env) {
	const configured = typeof env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] === 'string'
		&& env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV]!.trim().length > 0;
	return {
		envVar: TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
		configured,
		recommendedLaunch: `Export ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} in a shell and launch \`code .\` from that shell before starting the Codex session.`,
	};
}

export async function inspectTreeseedKeyAgentTransportDiagnostic() {
	const { socketPath, pidPath } = getTreeseedKeyAgentPaths();
	const diagnostics = await inspectTreeseedKeyAgentDiagnostics(socketPath);
	return {
		socketPath,
		pidPath,
		...diagnostics,
	};
}

function createDefaultRemoteHost() {
	return {
		id: 'official',
		label: 'TreeSeed Official API',
		baseUrl: DEFAULT_TREESEED_API_BASE_URL,
		official: true,
	};
}

function createDefaultRemoteSettings() {
	return {
		activeHostId: 'official',
		executionMode: 'prefer-local',
		hosts: [createDefaultRemoteHost()],
	};
}

function normalizeRemoteSettings(value) {
	const record = value && typeof value === 'object' ? value : {};
	const hosts = Array.isArray(record.hosts)
		? record.hosts
			.filter((entry) => entry && typeof entry === 'object')
			.map((entry) => ({
				id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : 'official',
				label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : undefined,
				baseUrl: typeof entry.baseUrl === 'string' && entry.baseUrl.trim() ? entry.baseUrl.trim().replace(/\/$/u, '') : DEFAULT_TREESEED_API_BASE_URL,
				official: entry.official === true,
			}))
		: [createDefaultRemoteHost()];

	return {
		activeHostId:
			typeof record.activeHostId === 'string' && record.activeHostId.trim()
				? record.activeHostId.trim()
				: hosts[0]?.id ?? 'official',
		executionMode:
			record.executionMode === 'prefer-remote' || record.executionMode === 'remote-only'
				? record.executionMode
				: 'prefer-local',
		hosts,
	};
}

function createDefaultServiceSettings() {
	return {
		railway: {
			projectId: '',
			projectName: '',
			apiServiceId: '',
			apiServiceName: '',
		},
	};
}

function normalizeServiceSettings(value) {
	const record = value && typeof value === 'object' ? value : {};
	const railway = record.railway && typeof record.railway === 'object' ? record.railway : {};
	return {
		railway: {
			projectId: typeof railway.projectId === 'string' ? railway.projectId : '',
			projectName: typeof railway.projectName === 'string' ? railway.projectName : '',
			apiServiceId: typeof railway.apiServiceId === 'string' ? railway.apiServiceId : '',
			apiServiceName: typeof railway.apiServiceName === 'string' ? railway.apiServiceName : '',
		},
	};
}

function ensureParent(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

export function listDeprecatedTreeseedLocalEnvFiles(tenantRoot) {
	return DEPRECATED_LOCAL_ENV_FILES
		.map((fileName) => resolve(tenantRoot, fileName))
		.filter((filePath) => existsSync(filePath));
}

export function warnDeprecatedTreeseedLocalEnvFiles(tenantRoot, write = (line: string) => console.warn(line)) {
	const existing = listDeprecatedTreeseedLocalEnvFiles(tenantRoot);
	if (existing.length === 0 || warnedDeprecatedLocalEnvRoots.has(tenantRoot)) {
		return existing;
	}

	warnedDeprecatedLocalEnvRoots.add(tenantRoot);
	write(
		`Treeseed ignores deprecated local env files: ${existing.map((filePath) => filePath.replace(`${tenantRoot}/`, '')).join(', ')}. Delete them and rely on .treeseed/config/machine.yaml plus Treeseed-launched commands.`,
	);
	return existing;
}

function maskValue(value) {
	if (!value) {
		return '(unset)';
	}
	if (value.length <= 8) {
		return '********';
	}
	return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function writeDeploySummary(write, summary) {
	write('Treeseed deployment summary');
	write(`  Target: ${summary.target}`);
	write(`  Worker: ${summary.workerName}`);
	write(`  Site URL: ${summary.siteUrl}`);
	write(`  Account ID: ${summary.accountId}`);
	write(`  D1: ${summary.siteDataDb.databaseName} (${summary.siteDataDb.databaseId})`);
	write(`  KV FORM_GUARD_KV: ${summary.formGuardKv.id}`);
	write(`  KV SESSION: ${summary.sessionKv.id}`);
}

function syncManagedServiceSettingsFromDeployConfig(tenantRoot) {
	const config = loadTreeseedMachineConfig(tenantRoot);
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const railway = config.settings.services.railway;
	railway.projectId = deployConfig.services?.api?.railway?.projectId
		?? railway.projectId;
	railway.projectName = deployConfig.services?.api?.railway?.projectName
		?? railway.projectName;
	railway.apiServiceId = deployConfig.services?.api?.railway?.serviceId ?? railway.apiServiceId;
	railway.apiServiceName = deployConfig.services?.api?.railway?.serviceName ?? railway.apiServiceName;

	const remote = normalizeRemoteSettings(config.settings.remote);
	const defaultHostBaseUrl = process.env[TREESEED_API_BASE_URL_ENV]
		?? deployConfig.services?.api?.environments?.prod?.baseUrl
		?? deployConfig.services?.api?.publicBaseUrl
		?? remote.hosts[0]?.baseUrl
		?? DEFAULT_TREESEED_API_BASE_URL;
	const officialHost = remote.hosts.find((entry) => entry.id === 'official');
	if (officialHost) {
		officialHost.baseUrl = defaultHostBaseUrl.replace(/\/$/u, '');
	} else {
		remote.hosts.unshift({
			id: 'official',
			label: 'TreeSeed Official API',
			baseUrl: defaultHostBaseUrl.replace(/\/$/u, ''),
			official: true,
		});
	}
	config.settings.remote = remote;
	writeTreeseedMachineConfig(tenantRoot, config);
	return config;
}

function loadTenantDeployConfig(tenantRoot) {
	return loadCliDeployConfig(tenantRoot);
}

function loadOptionalTenantManifest(tenantRoot) {
	try {
		return withProcessCwd(tenantRoot, () => loadTreeseedManifest());
	} catch {
		return undefined;
	}
}

function findNearestTreeseedMachineConfig(startRoot = process.cwd()) {
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
	const homeRoot = process.env.HOME && process.env.HOME.trim().length > 0 ? process.env.HOME : homedir();
	return {
		configPath: resolve(tenantRoot, MACHINE_CONFIG_RELATIVE_PATH),
		authPath: resolve(tenantRoot, REMOTE_AUTH_RELATIVE_PATH),
		keyPath: resolve(homeRoot, MACHINE_KEY_HOME_RELATIVE_PATH),
		legacyKeyPath: resolve(tenantRoot, LEGACY_MACHINE_KEY_RELATIVE_PATH),
	};
}

function keyAgentScriptPath() {
	return packageScriptPath('key-agent.ts');
}

function keyAgentRunTsPath() {
	return packageScriptPath('run-ts.mjs');
}

function keyAgentScriptCwd() {
	return dirname(dirname(keyAgentRunTsPath()));
}

function sleepMs(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function shellQuote(value: string) {
	return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function keyAgentAutoPromptEnabled() {
	const value = String(process.env[TREESEED_KEY_AGENT_AUTOPROMPT_ENV] ?? '').trim().toLowerCase();
	if (value === '0' || value === 'false' || value === 'off') {
		return false;
	}
	return process.stdin.isTTY && process.stdout.isTTY;
}

function useInlineKeyAgentTransport() {
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

function startTreeseedKeyAgentDaemon(tenantRoot) {
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const { socketPath } = getTreeseedKeyAgentPaths();
	const command = [
		shellQuote(process.execPath),
		shellQuote(keyAgentRunTsPath()),
		shellQuote(keyAgentScriptPath()),
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

function runTreeseedKeyAgentCommand(args, options = {}) {
	const result = spawnSync(process.execPath, [
		keyAgentRunTsPath(),
		keyAgentScriptPath(),
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
	});
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

function requestTreeseedKeyAgent(tenantRoot, payload, { ensureRunning = false, env } = {}) {
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

export function inspectTreeseedKeyAgentStatus(tenantRoot): TreeseedKeyAgentStatus {
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const { socketPath } = getTreeseedKeyAgentPaths();
	const wrapped = readWrappedMachineKeyFile(keyPath);
	if (useInlineKeyAgentTransport()) {
		const session = inlineTreeseedSecretSessions.get(keyPath) ?? { machineKey: null, lastTouchedAt: 0, idleTimeoutMs: TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS };
		const idleRemainingMs = session.machineKey
			? Math.max(0, session.idleTimeoutMs - (Date.now() - session.lastTouchedAt))
			: 0;
		if (idleRemainingMs === 0) {
			session.machineKey = null;
		}
		inlineTreeseedSecretSessions.set(keyPath, session);
		return {
			running: true,
			unlocked: Boolean(session.machineKey) && idleRemainingMs > 0,
			wrappedKeyPresent: wrapped.exists && Boolean(wrapped.wrapped),
			migrationRequired: wrapped.migrationRequired,
			keyPath,
			socketPath,
			idleTimeoutMs: session.idleTimeoutMs,
			idleRemainingMs,
		};
	}
	const response = requestTreeseedKeyAgent(tenantRoot, {
		command: 'status',
		keyPath,
		socketPath,
		idleTimeoutMs: TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS,
	});
	if (response.ok && response.status) {
		return response.status;
	}
	return {
		running: false,
		unlocked: false,
		wrappedKeyPresent: wrapped.exists && Boolean(wrapped.wrapped),
		migrationRequired: wrapped.migrationRequired,
		keyPath,
		socketPath,
		idleTimeoutMs: TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS,
		idleRemainingMs: 0,
	};
}

export function unlockTreeseedSecretSessionInteractive(tenantRoot) {
	if (useInlineKeyAgentTransport()) {
		throw new TreeseedKeyAgentError('interactive_required', 'Inline test transport does not support interactive unlock.');
	}
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const { socketPath } = getTreeseedKeyAgentPaths();
	startTreeseedKeyAgentDaemon(tenantRoot);
	let response = { ok: false, code: 'daemon_unavailable', message: 'Treeseed key agent is unavailable.' };
	for (let attempt = 0; attempt < 20; attempt += 1) {
		response = runTreeseedKeyAgentCommand([
			'unlock-interactive',
			'--key-path',
			keyPath,
			'--socket-path',
			socketPath,
			'--idle-timeout-ms',
			String(TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS),
			'--allow-migration',
			'--create-if-missing',
		]);
		if (response.code !== 'daemon_unavailable') {
			break;
		}
		sleepMs(25);
	}
	assertTreeseedKeyAgentResponse(response, 'Unable to unlock the Treeseed secret session.');
	return response.status;
}

export function unlockTreeseedSecretSessionFromEnv(tenantRoot, options = {}) {
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const { socketPath } = getTreeseedKeyAgentPaths();
	if (useInlineKeyAgentTransport()) {
		const passphrase = String(process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
		if (!passphrase) {
			throw new TreeseedKeyAgentError(
				'interactive_required',
				`Set ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} before unlocking the Treeseed secret session.`,
			);
		}
		const wrapped = readWrappedMachineKeyFile(keyPath);
		const machineKey = wrapped.wrapped
			? unwrapMachineKey(wrapped.wrapped, passphrase)
			: wrapped.plaintextLegacy
				? (() => {
					if (options.allowMigration === false) {
						throw new TreeseedKeyAgentError('wrapped_key_migration_required', 'Wrap the legacy machine key before unlocking it.');
					}
					replaceWrappedMachineKey(keyPath, wrapped.plaintextLegacy, passphrase);
					return wrapped.plaintextLegacy;
				})()
				: (() => {
					if (options.createIfMissing === false) {
						throw new TreeseedKeyAgentError('wrapped_key_missing', 'No wrapped Treeseed machine key exists yet.');
					}
					const createdKey = randomBytes(32);
					replaceWrappedMachineKey(keyPath, createdKey, passphrase);
					return createdKey;
				})();
		inlineTreeseedSecretSessions.set(keyPath, {
			machineKey,
			lastTouchedAt: Date.now(),
			idleTimeoutMs: TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS,
		});
		return inspectTreeseedKeyAgentStatus(tenantRoot);
	}
	startTreeseedKeyAgentDaemon(tenantRoot);
	let response = { ok: false, code: 'daemon_unavailable', message: 'Treeseed key agent is unavailable.' };
	for (let attempt = 0; attempt < 20; attempt += 1) {
		try {
			const parsed = runTreeseedKeyAgentCommand([
				'unlock-from-env',
				'--key-path',
				keyPath,
				'--socket-path',
				socketPath,
				'--idle-timeout-ms',
				String(TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS),
				...(options.allowMigration === false ? [] : ['--allow-migration']),
				...(options.createIfMissing === false ? [] : ['--create-if-missing']),
			]);
			assertTreeseedKeyAgentResponse(parsed, `Unable to unlock the Treeseed secret session from ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV}.`);
			return parsed.status;
		} catch (error) {
			if (attempt === 19) {
				throw error;
			}
			sleepMs(25);
		}
	}
	assertTreeseedKeyAgentResponse(
		response as never,
		`Unable to unlock the Treeseed secret session from ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV}.`,
	);
	return (response as never).status;
}

export function unlockTreeseedSecretSessionWithPassphrase(tenantRoot, passphrase, options = {}) {
	const normalizedPassphrase = String(passphrase ?? '').trim();
	if (!normalizedPassphrase) {
		throw new TreeseedKeyAgentError(
			'interactive_required',
			`Set ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} before unlocking the Treeseed secret session.`,
		);
	}
	const previousPassphrase = process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV];
	process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] = normalizedPassphrase;
	try {
		if (useInlineKeyAgentTransport()) {
			return unlockTreeseedSecretSessionFromEnv(tenantRoot, options);
		}
		const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
		const { socketPath } = getTreeseedKeyAgentPaths();
		startTreeseedKeyAgentDaemon(tenantRoot);
		let response = { ok: false, code: 'daemon_unavailable', message: 'Treeseed key agent is unavailable.' };
		for (let attempt = 0; attempt < 20; attempt += 1) {
			response = runTreeseedKeyAgentCommand([
				'unlock-from-env',
				'--key-path',
				keyPath,
				'--socket-path',
				socketPath,
				'--idle-timeout-ms',
				String(TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS),
				...(options.allowMigration === false ? [] : ['--allow-migration']),
				...(options.createIfMissing === false ? [] : ['--create-if-missing']),
			], {
				env: {
					[TREESEED_MACHINE_KEY_PASSPHRASE_ENV]: normalizedPassphrase,
				},
			});
			if (response.code !== 'daemon_unavailable') {
				break;
			}
			sleepMs(25);
		}
		assertTreeseedKeyAgentResponse(
			response,
			`Unable to unlock the Treeseed secret session from ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV}.`,
		);
		return response.status;
	} finally {
		if (previousPassphrase === undefined) {
			delete process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV];
		} else {
			process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] = previousPassphrase;
		}
	}
}

export async function ensureTreeseedSecretSessionForConfig({
	tenantRoot,
	interactive = false,
	env = process.env,
	createIfMissing = true,
	allowMigration = true,
	promptForPassphrase,
	promptForNewPassphrase,
}: {
	tenantRoot: string;
	interactive?: boolean;
	env?: NodeJS.ProcessEnv;
	createIfMissing?: boolean;
	allowMigration?: boolean;
	promptForPassphrase?: () => Promise<string> | string;
	promptForNewPassphrase?: () => Promise<string> | string;
}): Promise<TreeseedConfigSecretSessionBootstrap> {
	const status = inspectTreeseedKeyAgentStatus(tenantRoot);
	if (status.unlocked) {
		return {
			status,
			createdWrappedKey: false,
			migratedWrappedKey: false,
			unlockSource: 'existing-session',
		};
	}

	const wrappedBefore = readWrappedMachineKeyFile(status.keyPath);
	const envPassphrase = String(env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
	let unlockSource: 'interactive' | 'env' | 'existing-session' = 'existing-session';
	let nextStatus: TreeseedKeyAgentStatus;

	if (envPassphrase) {
		nextStatus = unlockTreeseedSecretSessionWithPassphrase(tenantRoot, envPassphrase, {
			createIfMissing,
			allowMigration,
		});
		unlockSource = 'env';
	} else if (interactive && status.migrationRequired) {
		if (!promptForNewPassphrase) {
			throw new TreeseedKeyAgentError('interactive_required', 'A passphrase prompt is required to migrate the Treeseed machine key.');
		}
		nextStatus = unlockTreeseedSecretSessionWithPassphrase(tenantRoot, await promptForNewPassphrase(), {
			createIfMissing: false,
			allowMigration: true,
		});
		unlockSource = 'interactive';
	} else if (interactive && !status.wrappedKeyPresent) {
		if (!promptForNewPassphrase) {
			throw new TreeseedKeyAgentError('interactive_required', 'A passphrase prompt is required to create the Treeseed machine key.');
		}
		nextStatus = unlockTreeseedSecretSessionWithPassphrase(tenantRoot, await promptForNewPassphrase(), {
			createIfMissing: true,
			allowMigration: false,
		});
		unlockSource = 'interactive';
	} else if (interactive) {
		if (!promptForPassphrase) {
			throw new TreeseedKeyAgentError('interactive_required', 'A passphrase prompt is required to unlock the Treeseed machine key.');
		}
		nextStatus = unlockTreeseedSecretSessionWithPassphrase(tenantRoot, await promptForPassphrase(), {
			createIfMissing: false,
			allowMigration: false,
		});
		unlockSource = 'interactive';
	} else if (status.migrationRequired) {
		throw new TreeseedKeyAgentError(
			'wrapped_key_migration_required',
			`Set ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} before running treeseed config non-interactively so Treeseed can wrap the legacy machine key.`,
			{ keyPath: status.keyPath },
		);
	} else if (!status.wrappedKeyPresent) {
		throw new TreeseedKeyAgentError(
			'wrapped_key_missing',
			`Set ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} before running treeseed config non-interactively so Treeseed can create the wrapped machine key.`,
			{ keyPath: status.keyPath },
		);
	} else {
		throw new TreeseedKeyAgentError(
			'locked',
			`Set ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} before running treeseed config non-interactively so Treeseed can unlock the wrapped machine key.`,
			{ keyPath: status.keyPath },
		);
	}

	const wrappedAfter = readWrappedMachineKeyFile(status.keyPath);
	return {
		status: nextStatus,
		createdWrappedKey: !wrappedBefore.wrapped && Boolean(wrappedAfter.wrapped) && !wrappedBefore.migrationRequired,
		migratedWrappedKey: wrappedBefore.migrationRequired && Boolean(wrappedAfter.wrapped),
		unlockSource,
	};
}

export function lockTreeseedSecretSession(tenantRoot) {
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	if (useInlineKeyAgentTransport()) {
		inlineTreeseedSecretSessions.set(keyPath, {
			machineKey: null,
			lastTouchedAt: 0,
			idleTimeoutMs: TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS,
		});
		return inspectTreeseedKeyAgentStatus(tenantRoot);
	}
	const status = inspectTreeseedKeyAgentStatus(tenantRoot);
	if (!status.running) {
		return status;
	}
	const response = requestTreeseedKeyAgent(tenantRoot, {
		command: 'lock',
		keyPath: status.keyPath,
		socketPath: status.socketPath,
		idleTimeoutMs: status.idleTimeoutMs,
	});
	assertTreeseedKeyAgentResponse(response, 'Unable to lock the Treeseed secret session.');
	return response.status;
}

function resolveUnlockedMachineKey(tenantRoot) {
	const status = inspectTreeseedKeyAgentStatus(tenantRoot);
	if (!status.unlocked) {
		const envPassphrase = String(process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
		if (envPassphrase) {
			unlockTreeseedSecretSessionFromEnv(tenantRoot);
		} else if (keyAgentAutoPromptEnabled()) {
			unlockTreeseedSecretSessionInteractive(tenantRoot);
		} else if (status.migrationRequired) {
			throw new TreeseedKeyAgentError(
				'wrapped_key_migration_required',
				'The Treeseed machine key is still stored in the legacy plaintext format. Run `treeseed secrets:migrate-key` or unlock it from an interactive session first.',
				{ keyPath: status.keyPath },
			);
		} else if (!status.wrappedKeyPresent) {
			throw new TreeseedKeyAgentError(
				'wrapped_key_missing',
				`No wrapped Treeseed machine key exists yet. Run \`treeseed config\` or \`treeseed secrets:unlock\` from an interactive shell, or set ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} for the startup unlock path.`,
				{ keyPath: status.keyPath },
			);
		} else {
			throw new TreeseedKeyAgentError(
				'locked',
				`Treeseed secrets are locked. Run \`treeseed secrets:unlock\`, unlock from an interactive session, or set ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} for the startup unlock path before using secret-backed commands.`,
				{ keyPath: status.keyPath },
			);
		}
	}
	if (useInlineKeyAgentTransport()) {
		const session = inlineTreeseedSecretSessions.get(status.keyPath);
		if (!session?.machineKey) {
			throw new TreeseedKeyAgentError('locked', 'Treeseed secrets are locked.');
		}
		session.lastTouchedAt = Date.now();
		return session.machineKey;
	}
	const response = requestTreeseedKeyAgent(tenantRoot, {
		command: 'get-machine-key',
		keyPath: status.keyPath,
		socketPath: status.socketPath,
		idleTimeoutMs: status.idleTimeoutMs,
	});
	assertTreeseedKeyAgentResponse(response, 'Unable to resolve the Treeseed machine key from the local key agent.');
	return Buffer.from(String(response.machineKey ?? ''), 'base64');
}

export function getTreeseedRemoteAuthPaths(tenantRoot) {
	return {
		authPath: getTreeseedMachineConfigPaths(tenantRoot).authPath,
	};
}

export type TreeseedConfigScope = (typeof TREESEED_ENVIRONMENT_SCOPES)[number];

export type TreeseedConfigEntrySnapshot = {
	id: string;
	label: string;
	group: string;
	cluster: string;
	startupProfile: 'core' | 'optional' | 'advanced';
	requirement: 'required' | 'conditional' | 'optional';
	description: string;
	howToGet: string;
	sensitivity: 'secret' | 'plain' | 'derived';
	targets: string[];
	purposes: string[];
	storage: 'shared' | 'scoped';
	validation?: TreeseedEnvironmentValidation;
	scope: TreeseedConfigScope;
	sharedScopes: TreeseedConfigScope[];
	required: boolean;
	currentValue: string;
	suggestedValue: string;
	effectiveValue: string;
};

export type TreeseedCollectedConfigContext = {
	tenantRoot: string;
	scopes: TreeseedConfigScope[];
	project: {
		name: string;
		slug: string;
		siteUrl: string;
	};
	configPath: string;
	keyPath: string;
	entriesByScope: Record<TreeseedConfigScope, TreeseedConfigEntrySnapshot[]>;
	valuesByScope: Record<TreeseedConfigScope, Record<string, string>>;
	suggestedValuesByScope: Record<TreeseedConfigScope, Record<string, string>>;
	configReadinessByScope: Record<TreeseedConfigScope, ReturnType<typeof createConfigReadiness>>;
	validationByScope: Record<TreeseedConfigScope, ReturnType<typeof validateTreeseedEnvironmentValues>>;
	sharedStorageMigrations: TreeseedSharedStorageMigrationNotice[];
	registry: ReturnType<typeof collectTreeseedEnvironmentContext>;
};

export type TreeseedConfigSecretSessionBootstrap = {
	status: TreeseedKeyAgentStatus;
	createdWrappedKey: boolean;
	migratedWrappedKey: boolean;
	unlockSource: 'interactive' | 'env' | 'existing-session';
};

export type TreeseedConfigValueUpdate = {
	scope: TreeseedConfigScope;
	entryId: string;
	value: string;
	reused?: boolean;
};

export type TreeseedSharedStorageMigrationNotice = {
	entryId: string;
	label: string;
	promotedFrom: TreeseedConfigScope;
	consolidatedScopes: TreeseedConfigScope[];
	hadConflicts: boolean;
};

export function createDefaultTreeseedMachineConfig({ tenantRoot, deployConfig, tenantConfig }) {
	return {
		version: 1,
		project: {
			tenantRoot,
			tenantId: tenantConfig?.id ?? deployConfig.slug,
			slug: deployConfig.slug,
			name: deployConfig.name,
			siteUrl: deployConfig.siteUrl,
			overlayPath: resolve(tenantRoot, TENANT_ENVIRONMENT_OVERLAY_PATH),
		},
		settings: {
			sync: {
				github: true,
				cloudflare: true,
			},
			templates: {
				catalogEndpoint: DEFAULT_TEMPLATE_CATALOG_URL,
			},
			remote: createDefaultRemoteSettings(),
			services: createDefaultServiceSettings(),
		},
		shared: {
			values: {},
			secrets: {},
		},
		environments: Object.fromEntries(
			TREESEED_ENVIRONMENT_SCOPES.map((scope) => [
				scope,
				{
					values: {},
					secrets: {},
				},
			]),
		),
	};
}

function loadLegacyMachineKey(tenantRoot) {
	const { legacyKeyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	if (!existsSync(legacyKeyPath)) {
		return null;
	}
	try {
		return Buffer.from(readFileSync(legacyKeyPath, 'utf8').trim(), 'base64');
	} catch {
		return null;
	}
}

function createDefaultRemoteAuthState() {
	return {
		version: 1,
		sessions: {},
	};
}

function encryptValue(value, key) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return {
		algorithm: 'aes-256-gcm',
		iv: iv.toString('base64'),
		tag: tag.toString('base64'),
		ciphertext: ciphertext.toString('base64'),
	};
}

function decryptValue(payload, key) {
	if (!payload || typeof payload !== 'object') {
		return '';
	}

	const decipher = createDecipheriv(
		'aes-256-gcm',
		key,
		Buffer.from(String(payload.iv ?? ''), 'base64'),
	);
	decipher.setAuthTag(Buffer.from(String(payload.tag ?? ''), 'base64'));
	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(String(payload.ciphertext ?? ''), 'base64')),
		decipher.final(),
	]);
	return decrypted.toString('utf8');
}

function decryptMachineConfigSecrets(config, key) {
	const secrets = {
		shared: {},
	};
	for (const [entryId, payload] of Object.entries(config.shared?.secrets ?? {})) {
		secrets.shared[entryId] = decryptValue(payload, key);
	}
	for (const scope of TREESEED_ENVIRONMENT_SCOPES) {
		secrets[scope] = {};
		for (const [entryId, payload] of Object.entries(config.environments?.[scope]?.secrets ?? {})) {
			secrets[scope][entryId] = decryptValue(payload, key);
		}
	}
	return secrets;
}

function applyMachineConfigSecrets(config, secrets, key) {
	for (const [entryId, value] of Object.entries(secrets.shared ?? {})) {
		config.shared.secrets[entryId] = encryptValue(value, key);
	}
	for (const scope of TREESEED_ENVIRONMENT_SCOPES) {
		const scoped = config.environments?.[scope];
		if (!scoped) {
			continue;
		}
		for (const [entryId, value] of Object.entries(secrets[scope] ?? {})) {
			scoped.secrets[entryId] = encryptValue(value, key);
		}
	}
	return config;
}

function decryptRemoteAuthSessions(payload, key) {
	return Object.fromEntries(
		Object.entries(payload.sessions ?? {}).map(([hostId, entry]) => [
			hostId,
			{
				accessToken: decryptValue(entry.accessToken, key),
				refreshToken: decryptValue(entry.refreshToken, key),
				expiresAt: typeof entry.expiresAt === 'string' ? entry.expiresAt : '',
				principal: entry.principal ?? null,
			},
		]),
	);
}

function encryptRemoteAuthSessions(sessions, key) {
	return Object.fromEntries(
		Object.entries(sessions ?? {}).map(([hostId, entry]) => [
			hostId,
			{
				accessToken: entry.accessToken ? encryptValue(entry.accessToken, key) : null,
				refreshToken: entry.refreshToken ? encryptValue(entry.refreshToken, key) : null,
				expiresAt: entry.expiresAt ?? '',
				principal: entry.principal ?? null,
			},
		]),
	);
}

function loadRemoteAuthPayload(tenantRoot) {
	const { authPath } = getTreeseedRemoteAuthPaths(tenantRoot);
	if (!existsSync(authPath)) {
		return createDefaultRemoteAuthState();
	}

	try {
		const raw = JSON.parse(readFileSync(authPath, 'utf8'));
		return raw && typeof raw === 'object' ? raw : createDefaultRemoteAuthState();
	} catch {
		return createDefaultRemoteAuthState();
	}
}

function writeRemoteAuthPayload(tenantRoot, payload) {
	const { authPath } = getTreeseedRemoteAuthPaths(tenantRoot);
	ensureParent(authPath);
	writeFileSync(authPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function removeLegacyMachineKeyIfSafe(tenantRoot) {
	const { legacyKeyPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	if (legacyKeyPath !== keyPath && existsSync(legacyKeyPath)) {
		rmSync(legacyKeyPath, { force: true });
	}
}

function reencryptTreeseedEncryptedState(tenantRoot, oldKey, newKey) {
	const machineConfig = loadTreeseedMachineConfig(tenantRoot);
	const machineSecrets = decryptMachineConfigSecrets(machineConfig, oldKey);
	const { authPath } = getTreeseedRemoteAuthPaths(tenantRoot);
	const remoteAuthExists = existsSync(authPath);
	const remoteAuthPayload = loadRemoteAuthPayload(tenantRoot);
	const remoteSessions = decryptRemoteAuthSessions(remoteAuthPayload, oldKey);

	writeTreeseedMachineConfig(tenantRoot, applyMachineConfigSecrets(machineConfig, machineSecrets, newKey));
	if (remoteAuthExists || Object.keys(remoteSessions).length > 0) {
		writeRemoteAuthPayload(tenantRoot, {
			version: 1,
			sessions: encryptRemoteAuthSessions(remoteSessions, newKey),
		});
	}
}

function loadMachineKey(tenantRoot) {
	return resolveUnlockedMachineKey(tenantRoot);
}

function decryptValueWithMachineKey(tenantRoot, payload, key) {
	try {
		return decryptValue(payload, key);
	} catch (error) {
		const legacyKey = loadLegacyMachineKey(tenantRoot);
		if (!legacyKey) {
			throw error;
		}
		const value = decryptValue(payload, legacyKey);
		reencryptTreeseedEncryptedState(tenantRoot, legacyKey, key);
		removeLegacyMachineKeyIfSafe(tenantRoot);
		return value;
	}
}

export function rotateTreeseedMachineKey(tenantRoot) {
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const oldKey = loadMachineKey(tenantRoot);
	const newKey = randomBytes(32);

	reencryptTreeseedEncryptedState(tenantRoot, oldKey, newKey);
	const status = inspectTreeseedKeyAgentStatus(tenantRoot);
	if (!status.unlocked) {
		throw new TreeseedKeyAgentError('locked', 'Treeseed secrets must be unlocked before rotating the machine key.', { keyPath });
	}
	const wrapped = readWrappedMachineKeyFile(keyPath);
	if (!wrapped.wrapped) {
		throw new TreeseedKeyAgentError(
			wrapped.migrationRequired ? 'wrapped_key_migration_required' : 'wrapped_key_missing',
			wrapped.migrationRequired
				? 'Wrap the Treeseed machine key before rotating it.'
				: 'Create and unlock the Treeseed machine key before rotating it.',
			{ keyPath },
		);
	}
	const passphrase = String(process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
	if (!passphrase) {
		throw new TreeseedKeyAgentError(
			'interactive_required',
			`Set ${TREESEED_MACHINE_KEY_PASSPHRASE_ENV} when rotating the machine key non-interactively, or use \`treeseed secrets:rotate-machine-key\` from an interactive shell.`,
			{ keyPath },
		);
	}
	replaceWrappedMachineKey(keyPath, newKey, passphrase);
	unlockTreeseedSecretSessionFromEnv(tenantRoot, { allowMigration: false, createIfMissing: false });
	removeLegacyMachineKeyIfSafe(tenantRoot);

	return {
		keyPath,
		rotated: true,
	};
}

export function rotateTreeseedMachineKeyPassphrase(tenantRoot, passphrase) {
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const machineKey = loadMachineKey(tenantRoot);
	rotateWrappedMachineKeyPassphrase(keyPath, machineKey, passphrase);
	return {
		keyPath,
		rotated: true,
	};
}

export function migrateTreeseedMachineKeyToWrapped(tenantRoot, passphrase) {
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const wrapped = readWrappedMachineKeyFile(keyPath);
	if (wrapped.wrapped) {
		return {
			keyPath,
			migrated: false,
			alreadyWrapped: true,
		};
	}
	if (wrapped.plaintextLegacy) {
		replaceWrappedMachineKey(keyPath, wrapped.plaintextLegacy, passphrase);
	} else {
		const legacyKey = loadLegacyMachineKey(tenantRoot);
		if (!legacyKey) {
			throw new TreeseedKeyAgentError(
				'wrapped_key_missing',
				'No existing machine key was found to migrate.',
				{ keyPath },
			);
		}
		replaceWrappedMachineKey(keyPath, legacyKey, passphrase);
		removeLegacyMachineKeyIfSafe(tenantRoot);
	}
	return {
		keyPath,
		migrated: true,
		alreadyWrapped: false,
	};
}

export function loadTreeseedRemoteAuthState(tenantRoot) {
	const key = loadMachineKey(tenantRoot);
	const payload = loadRemoteAuthPayload(tenantRoot);
	let sessions;
	try {
		sessions = decryptRemoteAuthSessions(payload, key);
	} catch (error) {
		const legacyKey = loadLegacyMachineKey(tenantRoot);
		if (!legacyKey) {
			throw error;
		}
		sessions = decryptRemoteAuthSessions(payload, legacyKey);
		reencryptTreeseedEncryptedState(tenantRoot, legacyKey, key);
		removeLegacyMachineKeyIfSafe(tenantRoot);
	}
	return {
		version: 1,
		sessions,
	};
}

export function writeTreeseedRemoteAuthState(tenantRoot, state) {
	const key = loadMachineKey(tenantRoot);
	writeRemoteAuthPayload(tenantRoot, {
		version: 1,
		sessions: encryptRemoteAuthSessions(state.sessions, key),
	});
}

export function setTreeseedRemoteSession(tenantRoot, { hostId, accessToken, refreshToken, expiresAt, principal }) {
	const state = loadTreeseedRemoteAuthState(tenantRoot);
	state.sessions[hostId] = {
		accessToken,
		refreshToken,
		expiresAt,
		principal: principal ?? null,
	};
	writeTreeseedRemoteAuthState(tenantRoot, state);
	return state.sessions[hostId];
}

export function clearTreeseedRemoteSession(tenantRoot, hostId) {
	const state = loadTreeseedRemoteAuthState(tenantRoot);
	if (hostId) {
		delete state.sessions[hostId];
	} else {
		state.sessions = {};
	}
	writeTreeseedRemoteAuthState(tenantRoot, state);
	return state;
}

export function resolveTreeseedRemoteSession(tenantRoot, hostId) {
	const { authPath } = getTreeseedRemoteAuthPaths(tenantRoot);
	if (!existsSync(authPath)) {
		return null;
	}
	const sessionState = loadTreeseedRemoteAuthState(tenantRoot);
	const { configPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const selectedHostId = hostId ?? (existsSync(configPath) ? loadTreeseedMachineConfig(tenantRoot).settings?.remote?.activeHostId : 'official') ?? 'official';
	return sessionState.sessions?.[selectedHostId] ?? null;
}

export function loadTreeseedMachineConfig(tenantRoot) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const tenantConfig = loadOptionalTenantManifest(tenantRoot);
	const defaults = createDefaultTreeseedMachineConfig({ tenantRoot, deployConfig, tenantConfig });
	const { configPath } = getTreeseedMachineConfigPaths(tenantRoot);

	if (!existsSync(configPath)) {
		return defaults;
	}

	const raw = parseYaml(readFileSync(configPath, 'utf8')) ?? {};
	const parsed = raw && typeof raw === 'object' ? raw : {};
	return {
		...defaults,
		...parsed,
		project: {
			...defaults.project,
			...(parsed.project ?? {}),
		},
		settings: {
			...defaults.settings,
			...(parsed.settings ?? {}),
			sync: {
				...defaults.settings.sync,
				...(parsed.settings?.sync ?? {}),
			},
			templates: {
				...(defaults.settings.templates ?? {}),
				...(parsed.settings?.templates ?? {}),
			},
			remote: normalizeRemoteSettings({
				...(defaults.settings.remote ?? {}),
				...(parsed.settings?.remote ?? {}),
			}),
			services: normalizeServiceSettings({
				...(defaults.settings.services ?? {}),
				...(parsed.settings?.services ?? {}),
			}),
		},
		shared: {
			values: {
				...(defaults.shared?.values ?? {}),
				...(parsed.shared?.values ?? {}),
			},
			secrets: {
				...(defaults.shared?.secrets ?? {}),
				...(parsed.shared?.secrets ?? {}),
			},
		},
		environments: Object.fromEntries(
			TREESEED_ENVIRONMENT_SCOPES.map((scope) => [
				scope,
				{
					values: {
						...(defaults.environments?.[scope]?.values ?? {}),
						...(parsed.environments?.[scope]?.values ?? {}),
					},
					secrets: {
						...(defaults.environments?.[scope]?.secrets ?? {}),
						...(parsed.environments?.[scope]?.secrets ?? {}),
					},
				},
			]),
		),
	};
}

export function writeTreeseedMachineConfig(tenantRoot, config) {
	const { configPath } = getTreeseedMachineConfigPaths(tenantRoot);
	ensureParent(configPath);
	writeFileSync(configPath, stringifyYaml(config), 'utf8');
}

export function updateTreeseedDeployConfigFeatureToggles(
	tenantRoot: string,
	toggles: Partial<Record<'turnstile' | 'smtp', boolean>>,
) {
	const configPath = resolve(tenantRoot, 'treeseed.site.yaml');
	const current = parseYaml(readFileSync(configPath, 'utf8')) as Record<string, any> ?? {};
	const next = { ...current };

	if ('smtp' in toggles) {
		next.smtp = {
			...(current.smtp ?? {}),
			enabled: toggles.smtp === true,
		};
	}

	if ('turnstile' in toggles) {
		next.turnstile = {
			...(current.turnstile ?? {}),
			enabled: toggles.turnstile === true,
		};
	}

	writeFileSync(configPath, stringifyYaml(next), 'utf8');
}

export function resolveTreeseedRemoteConfig(startRoot = process.cwd(), env = process.env): RemoteTreeseedConfig {
	const machineConfigPath = findNearestTreeseedMachineConfig(startRoot);
	const tenantRoot = machineConfigPath ? resolve(dirname(dirname(machineConfigPath)), '..') : startRoot;
	const deployConfig = existsSync(resolve(tenantRoot, 'treeseed.site.yaml')) ? loadTenantDeployConfig(tenantRoot) : null;
	const machineConfig = machineConfigPath ? loadTreeseedMachineConfig(tenantRoot) : createDefaultTreeseedMachineConfig({
		tenantRoot: startRoot,
		deployConfig: {
			name: 'TreeSeed',
			slug: 'treeseed',
			siteUrl: DEFAULT_TREESEED_API_BASE_URL,
			contactEmail: 'hello@treeseed.ai',
		},
		tenantConfig: undefined,
	});
	const settings = normalizeRemoteSettings(machineConfig.settings?.remote);
	const deployBaseUrl = env[TREESEED_API_BASE_URL_ENV]
		?? deployConfig?.services?.api?.environments?.prod?.baseUrl
		?? deployConfig?.services?.api?.publicBaseUrl
		?? null;
	if (deployBaseUrl) {
		const officialHost = settings.hosts.find((entry) => entry.id === 'official');
		if (officialHost) {
			officialHost.baseUrl = deployBaseUrl.replace(/\/$/u, '');
		}
	}
	const envBaseUrl = env[TREESEED_API_BASE_URL_ENV];
	const hosts = envBaseUrl && envBaseUrl.trim().length > 0
		? [
			{
				id: 'env',
				label: 'Environment override',
				baseUrl: envBaseUrl.trim().replace(/\/$/u, ''),
			},
			...settings.hosts.filter((entry) => entry.id !== 'env'),
		]
		: settings.hosts;
	const activeHostId = envBaseUrl && envBaseUrl.trim().length > 0 ? 'env' : settings.activeHostId;
	const auth = resolveTreeseedRemoteSession(tenantRoot, activeHostId);

	return {
		hosts,
		activeHostId,
		executionMode: settings.executionMode,
		auth: auth
			? {
				accessToken: auth.accessToken,
				refreshToken: auth.refreshToken,
				expiresAt: auth.expiresAt,
				principal: auth.principal ?? null,
			}
			: undefined,
	};
}

export function resolveTreeseedTemplateCatalogEndpoint(startRoot = process.cwd(), env = process.env) {
	const envValue = env[TREESEED_TEMPLATE_CATALOG_URL_ENV];
	if (typeof envValue === 'string' && envValue.trim().length > 0) {
		return envValue.trim();
	}

	const machineConfigPath = findNearestTreeseedMachineConfig(startRoot);
	if (!machineConfigPath) {
		return DEFAULT_TEMPLATE_CATALOG_URL;
	}

	const raw = parseYaml(readFileSync(machineConfigPath, 'utf8')) ?? {};
	const parsed = raw && typeof raw === 'object' ? raw : {};
	const configuredEndpoint = parsed.settings?.templates?.catalogEndpoint;
	return typeof configuredEndpoint === 'string' && configuredEndpoint.trim().length > 0
		? configuredEndpoint.trim()
		: DEFAULT_TEMPLATE_CATALOG_URL;
}

export function resolveTreeseedTemplateCatalogCachePath(startRoot = process.cwd()) {
	const machineConfigPath = findNearestTreeseedMachineConfig(startRoot);
	if (machineConfigPath) {
		return resolve(dirname(dirname(machineConfigPath)), 'cache', 'template-catalog.json');
	}

	return resolve(tmpdir(), TEMPLATE_CATALOG_CACHE_RELATIVE_PATH);
}

export function ensureTreeseedGitignoreEntries(tenantRoot) {
	const gitignorePath = resolve(tenantRoot, '.gitignore');
	const requiredEntries = ['.treeseed/'];
	const current = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
	const lines = current.split(/\r?\n/);
	let changed = false;

	for (const entry of requiredEntries) {
		if (!lines.includes(entry)) {
			lines.push(entry);
			changed = true;
		}
	}

	if (changed || !existsSync(gitignorePath)) {
		writeFileSync(gitignorePath, `${lines.filter(Boolean).join('\n')}\n`, 'utf8');
	}

	return gitignorePath;
}

export type TreeseedRepairAction = {
	id: string;
	detail: string;
};

function dedupeRepairActions(actions: TreeseedRepairAction[]) {
	const seen = new Set<string>();
	return actions.filter((action) => {
		if (seen.has(action.id)) {
			return false;
		}
		seen.add(action.id);
		return true;
	});
}

export function applyTreeseedSafeRepairs(tenantRoot: string): TreeseedRepairAction[] {
	const actions: TreeseedRepairAction[] = [];
	ensureTreeseedGitignoreEntries(tenantRoot);
	actions.push({ id: 'gitignore', detail: 'Ensured Treeseed gitignore entries are present.' });
	const deprecatedFiles = warnDeprecatedTreeseedLocalEnvFiles(tenantRoot);
	if (deprecatedFiles.length > 0) {
		actions.push({ id: 'deprecated-local-env', detail: 'Detected deprecated .env.local/.dev.vars files that Treeseed now ignores.' });
	}

	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const { configPath } = getTreeseedMachineConfigPaths(tenantRoot);
	if (!existsSync(configPath)) {
		const machineConfig = createDefaultTreeseedMachineConfig({
			tenantRoot,
			deployConfig,
			tenantConfig: undefined,
		});
		writeTreeseedMachineConfig(tenantRoot, machineConfig);
		actions.push({ id: 'machine-config', detail: 'Created the default Treeseed machine config.' });
	}

	const keyStatus = inspectTreeseedKeyAgentStatus(tenantRoot);
	if (!keyStatus.wrappedKeyPresent && !keyStatus.migrationRequired) {
		actions.push({ id: 'machine-key', detail: 'Treeseed will create a wrapped machine key the first time the secret session is unlocked.' });
	} else if (keyStatus.migrationRequired) {
		actions.push({ id: 'machine-key-migration', detail: 'Detected a legacy plaintext machine key that must be wrapped on the next unlock.' });
	}

	const machineConfig = loadTreeseedMachineConfig(tenantRoot);
	writeTreeseedMachineConfig(tenantRoot, machineConfig);

	for (const scope of TREESEED_ENVIRONMENT_SCOPES) {
		const target = createPersistentDeployTarget(scope);
		const state = loadDeployState(tenantRoot, deployConfig, { target });
		if (state.readiness?.initialized || scope === 'local') {
			ensureGeneratedWranglerConfig(tenantRoot, { target });
			actions.push({ id: `wrangler-${scope}`, detail: `Regenerated the ${scope} generated Wrangler config.` });
		}
	}

	return dedupeRepairActions(actions);
}

function decryptMachineEnvironmentBucket(tenantRoot, config, key, bucket) {
	const values = {
		...(bucket?.values ?? {}),
	};

	for (const [entryId, payload] of Object.entries(bucket?.secrets ?? {})) {
		values[entryId] = decryptValueWithMachineKey(tenantRoot, payload, key);
	}

	return values;
}

function readMachineBucketEntryValue(tenantRoot, key, bucket, entry) {
	if (entry.sensitivity === 'secret') {
		const payload = bucket?.secrets?.[entry.id];
		return typeof payload === 'string' && payload.length > 0
			? decryptValueWithMachineKey(tenantRoot, payload, key)
			: '';
	}
	return typeof bucket?.values?.[entry.id] === 'string' ? bucket.values[entry.id] : '';
}

function writeMachineBucketEntryValue(target, entry, value, key) {
	if (entry.sensitivity === 'secret') {
		delete target.values[entry.id];
		if (value) {
			target.secrets[entry.id] = encryptValue(value, key);
		} else {
			delete target.secrets[entry.id];
		}
		return;
	}

	delete target.secrets[entry.id];
	if (value) {
		target.values[entry.id] = value;
	} else {
		delete target.values[entry.id];
	}
}

function migrateLegacyScopedSharedEntries(tenantRoot, config, registryEntries, key) {
	const notices: TreeseedSharedStorageMigrationNotice[] = [];
	let changed = false;

	for (const entry of registryEntries) {
		if (entry.storage !== 'shared') {
			continue;
		}

		const sharedValue = readMachineBucketEntryValue(tenantRoot, key, config.shared, entry);
		if (sharedValue.length > 0) {
			continue;
		}

		const scopedValues = TREESEED_ENVIRONMENT_SCOPES
			.map((scope) => ({
				scope,
				value: readMachineBucketEntryValue(tenantRoot, key, config.environments?.[scope], entry),
			}))
			.filter((candidate) => candidate.value.length > 0);
		if (scopedValues.length === 0) {
			continue;
		}

		const promotedFrom = (scopedValues.find((candidate) => candidate.scope === 'staging')
			?? scopedValues.find((candidate) => candidate.scope === 'prod')
			?? scopedValues[0]).scope;
		const promotedValue = scopedValues.find((candidate) => candidate.scope === promotedFrom)?.value ?? '';
		const hadConflicts = new Set(scopedValues.map((candidate) => candidate.value)).size > 1;

		writeMachineBucketEntryValue(config.shared, entry, promotedValue, key);
		for (const candidateScope of TREESEED_ENVIRONMENT_SCOPES) {
			delete config.environments[candidateScope].values[entry.id];
			delete config.environments[candidateScope].secrets[entry.id];
		}

		notices.push({
			entryId: entry.id,
			label: entry.label,
			promotedFrom,
			consolidatedScopes: scopedValues.map((candidate) => candidate.scope),
			hadConflicts,
		});
		changed = true;
	}

	if (changed) {
		writeTreeseedMachineConfig(tenantRoot, config);
	}

	return notices;
}

function resolveEntryValueFromBuckets(entry, entryId, scope, bucketValuesByScope) {
	if (!entry) {
		return bucketValuesByScope[scope]?.[entryId] ?? bucketValuesByScope.shared?.[entryId] ?? '';
	}
	if (entry?.storage === 'shared') {
		const sharedValue = bucketValuesByScope.shared?.[entryId];
		if (typeof sharedValue === 'string' && sharedValue.length > 0) {
			return sharedValue;
		}

		const searchScopes = [scope, ...TREESEED_ENVIRONMENT_SCOPES.filter((candidate) => candidate !== scope)];
		for (const candidateScope of searchScopes) {
			const candidateValue = bucketValuesByScope[candidateScope]?.[entryId];
			if (typeof candidateValue === 'string' && candidateValue.length > 0) {
				return candidateValue;
			}
		}
		return '';
	}

	return bucketValuesByScope[scope]?.[entryId] ?? '';
}

export function resolveTreeseedMachineEnvironmentValues(tenantRoot, scope) {
	const key = loadMachineKey(tenantRoot);
	const config = loadTreeseedMachineConfig(tenantRoot);
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const bucketValuesByScope = {
		shared: decryptMachineEnvironmentBucket(tenantRoot, config, key, config.shared),
		...Object.fromEntries(
			TREESEED_ENVIRONMENT_SCOPES.map((candidateScope) => [
				candidateScope,
				decryptMachineEnvironmentBucket(tenantRoot, config, key, config.environments?.[candidateScope]),
			]),
		),
	};
	const entryById = new Map(registry.entries.map((entry) => [entry.id, entry]));
	const values = {};
	const knownKeys = new Set(registry.entries.map((entry) => entry.id));

	for (const entryId of knownKeys) {
		const resolved = resolveEntryValueFromBuckets(entryById.get(entryId), entryId, scope, bucketValuesByScope);
		if (typeof resolved === 'string' && resolved.length > 0) {
			values[entryId] = resolved;
		}
	}

	return values;
}

export function setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, value) {
	const key = loadMachineKey(tenantRoot);
	const config = loadTreeseedMachineConfig(tenantRoot);
	const target = entry.storage === 'shared' ? config.shared : config.environments[scope];

	if (entry.storage === 'shared') {
		for (const candidateScope of TREESEED_ENVIRONMENT_SCOPES) {
			delete config.environments[candidateScope].values[entry.id];
			delete config.environments[candidateScope].secrets[entry.id];
		}
	}

	if (entry.sensitivity === 'secret') {
		delete target.values[entry.id];
		if (value) {
			target.secrets[entry.id] = encryptValue(value, key);
		} else {
			delete target.secrets[entry.id];
		}
	} else {
		delete target.secrets[entry.id];
		if (value) {
			target.values[entry.id] = value;
		} else {
			delete target.values[entry.id];
		}
	}

	writeTreeseedMachineConfig(tenantRoot, config);
	return config;
}

export function collectTreeseedEnvironmentContext(tenantRoot) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const tenantConfig = loadOptionalTenantManifest(tenantRoot);
	return resolveTreeseedEnvironmentRegistry({
		deployConfig,
		tenantConfig,
	});
}

export function collectTreeseedConfigSeedValues(tenantRoot, scope, env = process.env) {
	warnDeprecatedTreeseedLocalEnvFiles(tenantRoot);
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	let machineValues = {};
	try {
		machineValues = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	} catch (error) {
		if (!(error instanceof TreeseedKeyAgentError)) {
			throw error;
		}
	}
	return filterEnvironmentValuesByRegistry({
		...machineValues,
		...Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value ?? undefined])),
	}, registry, scope);
}

function collectTreeseedConfigSeedValueSources(tenantRoot, scope, env = process.env) {
	warnDeprecatedTreeseedLocalEnvFiles(tenantRoot);
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const registeredKeys = new Set(registry.entries
		.filter((entry) => isTreeseedEnvironmentEntryRelevant(entry, registry.context, scope, 'config'))
		.map((entry) => entry.id));
	const values = {};
	const sources = {};
	const merge = (source, entries) => {
		for (const [key, value] of Object.entries(entries)) {
			if (!registeredKeys.has(key)) {
				continue;
			}
			if (typeof value !== 'string' || value.length === 0) {
				continue;
			}
			values[key] = value;
			sources[key] = source;
		}
	};

	try {
		merge('machine-config', resolveTreeseedMachineEnvironmentValues(tenantRoot, scope));
	} catch (error) {
		if (!(error instanceof TreeseedKeyAgentError)) {
			throw error;
		}
	}
	merge('process.env', Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value ?? undefined])));

	return { values, sources };
}

export function resolveTreeseedLaunchEnvironment({
	tenantRoot,
	scope,
	baseEnv = process.env,
	overrides = {},
}: {
	tenantRoot: string;
	scope: TreeseedConfigScope;
	baseEnv?: NodeJS.ProcessEnv;
	overrides?: NodeJS.ProcessEnv;
}) {
	warnDeprecatedTreeseedLocalEnvFiles(tenantRoot);
	let machineValues = {};
	try {
		machineValues = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	} catch (error) {
		if (!(error instanceof TreeseedKeyAgentError)) {
			throw error;
		}
	}
	const scopedValues = scope === 'local'
		? { ...baseEnv, ...machineValues }
		: { ...machineValues, ...baseEnv };
	return {
		...scopedValues,
		...overrides,
	};
}

export function formatTreeseedConfigEnvironmentReport({ tenantRoot, scope, env = process.env, revealSecrets = false }) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const { values, sources } = collectTreeseedConfigSeedValueSources(tenantRoot, scope, env);
	const lines = [
		formatConfigSectionTitle(`Resolved environment values for ${scope}`),
		revealSecrets
			? 'Secrets are shown because --show-secrets was provided.'
			: 'Secret values are masked. Re-run with --show-secrets to print full values.',
	];

	for (const entry of listRelevantTreeseedConfigEntries(registry, scope)) {
		const value = values[entry.id];
		const displayValue = typeof value === 'string' && value.length > 0
			? (entry.sensitivity === 'secret' && !revealSecrets ? maskValue(value) : value)
			: '(unset)';
		lines.push(`${entry.id}=${displayValue} (${sources[entry.id] ?? 'unset'})`);
	}

	return lines.join('\n');
}

export function applyTreeseedEnvironmentToProcess({ tenantRoot, scope, override = false }) {
	let resolvedValues = {};
	try {
		resolvedValues = resolveTreeseedLaunchEnvironment({ tenantRoot, scope });
	} catch (error) {
		if (!(error instanceof TreeseedKeyAgentError)) {
			throw error;
		}
	}
	for (const [key, value] of Object.entries(resolvedValues)) {
		const currentValue = process.env[key] ?? '';
		const shouldReplacePlaceholder = key === 'CLOUDFLARE_ACCOUNT_ID' && currentValue === CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER;
		if ((override || currentValue.length === 0 || shouldReplacePlaceholder) && typeof value === 'string' && value.length > 0) {
			process.env[key] = value;
		}
	}
	return resolvedValues;
}

export function validateTreeseedCommandEnvironment({ tenantRoot, scope, purpose }) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const values = resolveTreeseedLaunchEnvironment({ tenantRoot, scope });
	const validation = validateTreeseedEnvironmentValues({
		values,
		scope,
		purpose,
		deployConfig: registry.context.deployConfig,
		tenantConfig: registry.context.tenantConfig,
		plugins: registry.context.plugins,
	});
	return {
		registry,
		values,
		validation,
	};
}

export function assertTreeseedCommandEnvironment({ tenantRoot, scope, purpose }) {
	const report = validateTreeseedCommandEnvironment({ tenantRoot, scope, purpose });
	if (report.validation.ok) {
		return report;
	}

	const lines = [
		`Treeseed environment is not ready for ${purpose} (${scope}).`,
		'Run `treeseed config` to fill in the missing values, or export them in the current shell.',
	];

	for (const problem of [...report.validation.missing, ...report.validation.invalid]) {
		lines.push(`- ${problem.message}`);
	}

	const error = new Error(lines.join('\n'));
	error.kind = report.validation.missing.length > 0 ? 'missing_config' : 'invalid_config';
	error.details = report.validation;
	throw error;
}

function runGh(args, { cwd, dryRun = false, input, env } = {}) {
	if (dryRun) {
		return { status: 0, stdout: '', stderr: '' };
	}
	const result = spawnSync('gh', args, {
		cwd,
		stdio: input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
		input,
		timeout: 15000,
		env: {
			...process.env,
			...(env ?? {}),
			GH_PROMPT_DISABLED: '1',
			GH_NO_UPDATE_NOTIFIER: '1',
		},
	});
	if (result.error?.code === 'ETIMEDOUT') {
		throw new Error(`gh ${args.join(' ')} timed out`);
	}
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `gh ${args.join(' ')} failed`);
	}
	return result;
}

function runRailway(args, { cwd, dryRun = false, input } = {}) {
	if (dryRun) {
		return { status: 0, stdout: '', stderr: '' };
	}
	const result = spawnSync('railway', args, {
		cwd,
		stdio: input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
		input,
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `railway ${args.join(' ')} failed`);
	}
	return result;
}

function commandAvailable(command) {
	const result = spawnSync('bash', ['-lc', `command -v ${command}`], {
		stdio: 'pipe',
		encoding: 'utf8',
	});
	return result.status === 0;
}

function checkCommand(command, args, { cwd, env } = {}) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
		env: { ...process.env, ...(env ?? {}) },
		timeout: CLI_CHECK_TIMEOUT_MS,
	});
	const timedOut = result.error && 'code' in result.error && result.error.code === 'ETIMEDOUT';
	const detail = timedOut
		? `Command timed out after ${CLI_CHECK_TIMEOUT_MS}ms: ${command} ${args.join(' ')}`
		: `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim();
	return {
		ok: result.status === 0,
		status: result.status ?? 1,
		stdout: result.stdout?.trim() ?? '',
		stderr: result.stderr?.trim() ?? '',
		detail,
	};
}

function toolStatus(name, available, detail, extra = {}) {
	return {
		name,
		available,
		detail,
		...extra,
	};
}

export function ensureTreeseedActVerificationTooling({ tenantRoot = process.cwd(), installIfMissing = true, env = process.env, write } = {}) {
	const githubCli = !commandAvailable('gh')
		? toolStatus('githubCli', false, 'GitHub CLI `gh` is not installed.')
		: (() => {
			const check = checkCommand('gh', ['--version'], { cwd: tenantRoot, env });
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
	const railwayCheck = checkCommand('railway', ['--version'], { cwd: tenantRoot, env });
	const railwayCli = toolStatus(
		'railwayCli',
		railwayCheck.ok,
		railwayCheck.ok
			? railwayCheck.stdout.split('\n')[0] ?? 'Railway CLI detected.'
			: railwayCheck.detail || 'Railway CLI is unavailable.',
	);

	if (githubCli.available) {
		const check = checkCommand('gh', ['act', '--version'], { cwd: tenantRoot, env });
		if (check.ok) {
			ghActExtension = toolStatus('ghActExtension', true, check.stdout.split('\n')[0] ?? 'gh-act is installed.', {
				attemptedInstall: false,
				installedDuringConfig: false,
			});
		} else if (installIfMissing) {
			write?.('Installing GitHub CLI extension `gh-act`...');
			const install = checkCommand('gh', ['extension', 'install', 'https://github.com/nektos/gh-act'], { cwd: tenantRoot, env });
			const postInstall = checkCommand('gh', ['act', '--version'], { cwd: tenantRoot, env });
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

function formatCheckOutput(result) {
	return `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim();
}

function providerConnectionResult(provider, ready, detail, extra = {}) {
	return {
		provider,
		ready,
		detail,
		...extra,
	};
}

function isTransientProviderConnectionError(detail) {
	return /fetch failed|failed to fetch|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|api check failed|rate.?limit|too many requests|429/iu.test(detail || '');
}

function checkGitHubConnection({ tenantRoot, env }) {
	if (!env.GH_TOKEN) {
		return providerConnectionResult('github', false, 'GH_TOKEN is not configured.', { skipped: true });
	}
	if (!commandAvailable('gh')) {
		return providerConnectionResult('github', false, 'GitHub CLI `gh` is not installed.');
	}
	const repository = maybeResolveGitHubRepositorySlug(tenantRoot);
	const args = repository
		? ['repo', 'view', repository, '--json', 'nameWithOwner', '--jq', '.nameWithOwner']
		: ['api', 'user', '--jq', '.login'];
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const result = spawnSync('gh', args, {
			cwd: tenantRoot,
			stdio: 'pipe',
			encoding: 'utf8',
			env: { ...process.env, ...env },
			timeout: CLI_CHECK_TIMEOUT_MS,
		});
		if (result.status === 0) {
			const resolved = result.stdout.trim();
			return providerConnectionResult(
				'github',
				true,
				repository
					? `GitHub token can access ${resolved || repository}.`
					: resolved ? `Authenticated as ${resolved}.` : 'GitHub API check succeeded.',
			);
		}
		const detail = formatCheckOutput(result) || 'GitHub API check failed.';
		if (attempt >= 2 || !isTransientProviderConnectionError(detail)) {
			return providerConnectionResult('github', false, detail);
		}
	}
	return providerConnectionResult('github', false, 'GitHub API check failed.');
}

function checkCloudflareConnection({ tenantRoot, env }) {
	if (!env.CLOUDFLARE_API_TOKEN) {
		return providerConnectionResult('cloudflare', false, 'CLOUDFLARE_API_TOKEN is not configured.', { skipped: true });
	}
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const result = spawnSync(process.execPath, [resolveWranglerBin(), 'whoami'], {
				cwd: tenantRoot,
				stdio: 'pipe',
				encoding: 'utf8',
				env: { ...process.env, ...env },
				timeout: CLI_CHECK_TIMEOUT_MS,
			});
			if (result.status === 0) {
				return providerConnectionResult('cloudflare', true, 'Wrangler authenticated with CLOUDFLARE_API_TOKEN.');
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

async function checkRailwayConnection({ tenantRoot, env }) {
	if (!env.RAILWAY_API_TOKEN) {
		return providerConnectionResult('railway', false, 'RAILWAY_API_TOKEN is not configured.', { skipped: true });
	}
	const workspaceName = env.TREESEED_RAILWAY_WORKSPACE || resolveRailwayWorkspace(env);
	const cacheKey = JSON.stringify({
		tenantRoot,
		token: env.RAILWAY_API_TOKEN,
		workspaceName,
	});
	const cached = railwayConnectionCheckCache.get(cacheKey);
	if (cached) {
		return await cached;
	}
	const checkPromise = (async () => {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				const whoami = checkCommand('railway', ['whoami'], { cwd: tenantRoot, env });
				if (!whoami.ok) {
					if (/rate.?limit|too many requests|429/iu.test(whoami.detail || '')) {
						return providerConnectionResult(
							'railway',
							false,
							'Railway connectivity preflight was rate-limited; bootstrap will continue and rely on API-backed reconcile verification.',
							{ skipped: true, warning: true, rateLimited: true },
						);
					}
					throw new Error(whoami.detail || 'Railway CLI authentication check failed.');
				}
				const identity = whoami.stdout
					.replace(/^logged in as\s+/iu, '')
					.replace(/\s*👋\s*$/u, '')
					.trim() || 'an account';
				return providerConnectionResult('railway', true, `Railway authenticated as ${identity} in workspace ${workspaceName}. Project and service existence will be reconciled during bootstrap.`);
			} catch (error) {
				const detail = error instanceof Error ? error.message : 'Railway API check failed.';
				if (attempt >= 2 || !isTransientProviderConnectionError(detail)) {
					return providerConnectionResult('railway', false, detail);
				}
			}
		}
		return providerConnectionResult('railway', false, 'Railway API check failed.');
	})();
	railwayConnectionCheckCache.set(cacheKey, checkPromise);
	try {
		return await checkPromise;
	} catch (error) {
		railwayConnectionCheckCache.delete(cacheKey);
		throw error;
	}
}

export async function checkTreeseedProviderConnections({ tenantRoot, scope = 'prod', env = process.env } = {}) {
	const values = collectTreeseedConfigSeedValues(tenantRoot, scope, env);
	const rawCommandEnv = {
		GH_TOKEN: values.GH_TOKEN,
		CLOUDFLARE_API_TOKEN: values.CLOUDFLARE_API_TOKEN,
		CLOUDFLARE_ACCOUNT_ID: values.CLOUDFLARE_ACCOUNT_ID,
		RAILWAY_API_TOKEN: values.RAILWAY_API_TOKEN,
		TREESEED_RAILWAY_WORKSPACE: values.TREESEED_RAILWAY_WORKSPACE || resolveRailwayWorkspace(values),
	};
	const commandEnv = buildRailwayCommandEnv(rawCommandEnv);
	const checks = [
		checkGitHubConnection({ tenantRoot, env: commandEnv }),
		checkCloudflareConnection({ tenantRoot, env: commandEnv }),
	];
	const railwayCheck = await checkRailwayConnection({ tenantRoot, env: commandEnv });
	checks.push(railwayCheck);
	return {
		scope,
		ok: checks.every((check) => check.ready || check.skipped),
		checks,
		issues: checks
			.filter((check) => !check.ready && !check.skipped)
			.map((check) => check.detail),
	};
}

export function formatTreeseedProviderConnectionReport(report) {
	const lines = [formatConfigSectionTitle(`Provider connection checks for ${report.scope}`)];
	for (const check of report.checks) {
		const label = check.provider[0].toUpperCase() + check.provider.slice(1);
		const status = check.ready ? colorize('ready', '32') : check.skipped ? colorize('skipped', '33') : colorize('failed', '31');
		lines.push(`${label}: ${status} - ${check.detail}`);
	}
	return lines.join('\n');
}

function formatTreeseedProviderConnectionFailures(
	reports: Array<ReturnType<typeof checkTreeseedProviderConnections>>,
) {
	const failing = reports.filter((report) => report.checks.some((check) => !check.ready && !check.skipped));
	if (failing.length === 0) {
		return '';
	}
	return [
		'Treeseed provider connection checks failed.',
		...failing.map((report) => formatTreeseedProviderConnectionReport(report)),
	].join('\n');
}

function writeProviderConnectionReport(write, report) {
	write(formatTreeseedProviderConnectionReport(report));
}

async function runBounded<T>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<void>,
) {
	const concurrency = Math.max(1, Math.min(limit, items.length || 1));
	let nextIndex = 0;
	const workers = Array.from({ length: concurrency }, async () => {
		for (;;) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= items.length) {
				return;
			}
			await worker(items[index]!, index);
		}
	});
	await Promise.all(workers);
}

export async function syncTreeseedGitHubEnvironment({
	tenantRoot,
	scope = 'prod',
	dryRun = false,
	repository: repositoryInput,
	execution = 'parallel',
	concurrency = 4,
	onProgress,
}: {
	tenantRoot: string;
	scope?: TreeseedConfigScope;
	dryRun?: boolean;
	repository?: string | null;
	execution?: 'parallel' | 'sequential';
	concurrency?: number;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
}) {
	const repository = repositoryInput ?? maybeResolveGitHubRepositorySlug(tenantRoot);
	if (!repository) {
		throw new Error('Unable to determine the GitHub repository from the origin remote.');
	}

	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const values = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	const relevant = registry.entries.filter((entry) => entry.scopes.includes(scope));
	const ghToken = values.GH_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
	const ghEnv = ghToken
		? {
			GH_TOKEN: ghToken,
			GITHUB_TOKEN: ghToken,
		}
		: {};
	const githubClient = createGitHubApiClient({ env: ghEnv });
	const environment = scope === 'prod' ? 'production' : scope;
	const deploymentBranch = scope === 'prod' ? PRODUCTION_BRANCH : scope === 'staging' ? STAGING_BRANCH : null;
	const progress = (message: string, stream: 'stdout' | 'stderr' = 'stdout') => onProgress?.(message, stream);
	if (!dryRun) {
		progress(`[${scope}][github][environment] Ensuring GitHub environment ${environment} exists...`);
		await ensureGitHubActionsEnvironment(repository, environment, {
			client: githubClient,
			branchName: deploymentBranch,
		});
	}
	progress(`[${scope}][github][sync] Loading existing GitHub secrets and variables...`);
	const [secretNames, variableNames] = dryRun
		? [new Set<string>(), new Set<string>()]
		: await Promise.all([
			listGitHubEnvironmentSecretNames(repository, environment, { client: githubClient }),
			listGitHubEnvironmentVariableNames(repository, environment, { client: githubClient }),
		]);
	const synced = {
		secrets: [] as Array<{ name: string; existed: boolean }>,
		variables: [] as Array<{ name: string; existed: boolean }>,
	};
	const items: Array<{ kind: 'secret' | 'variable'; name: string; value: string; existed: boolean }> = [];

	for (const entry of relevant) {
		const value = values[entry.id];
		if (!value) {
			continue;
		}

		if (entry.sensitivity === 'secret') {
			items.push({ kind: 'secret', name: entry.id, value, existed: secretNames.has(entry.id) });
		} else {
			items.push({ kind: 'variable', name: entry.id, value, existed: variableNames.has(entry.id) });
		}
	}
	let completed = 0;
	const total = items.length;
	progress(`[${scope}][github][sync] Syncing GitHub environment ${environment}: 0/${total} items...`);
	const limit = execution === 'sequential' ? 1 : concurrency;
	await runBounded(items, limit, async (item) => {
		if (!dryRun) {
			if (item.kind === 'secret') {
				await upsertGitHubEnvironmentSecret(repository, environment, item.name, item.value, { client: githubClient });
			} else {
				await upsertGitHubEnvironmentVariable(repository, environment, item.name, item.value, { client: githubClient });
			}
		}
		completed += 1;
		const action = item.existed ? 'updated' : 'created';
		progress(`[${scope}][github][${item.kind}] ${action} ${item.name} (${completed}/${total})`);
		if (item.kind === 'secret') {
			synced.secrets.push({ name: item.name, existed: item.existed });
		} else {
			synced.variables.push({ name: item.name, existed: item.existed });
		}
	});
	progress(`[${scope}][github][sync] Complete: ${synced.secrets.length} secrets, ${synced.variables.length} variables, ${total} total.`);

	return {
		repository,
		scope,
		environment,
		...synced,
	};
}

export function syncTreeseedCloudflareEnvironment({ tenantRoot, scope = 'prod', dryRun = false } = {}) {
	const values = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	const target = createPersistentDeployTarget(scope);
	for (const [key, value] of Object.entries(values)) {
		if (typeof value === 'string' && value.length > 0) {
			process.env[key] = value;
		}
	}

	const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	const syncedSecrets = syncCloudflareSecrets(tenantRoot, { dryRun, target });
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const cloudflareVars = registry.entries
		.filter((entry) => entry.scopes.includes(scope) && entry.targets.includes('cloudflare-var'))
		.map((entry) => entry.id)
		.filter((key) => typeof values[key] === 'string' && values[key].length > 0);

	return {
		scope,
		target,
		wranglerPath,
		secrets: syncedSecrets,
		varsManagedByWranglerConfig: cloudflareVars,
	};
}

export function syncTreeseedRailwayEnvironment({ tenantRoot, scope = 'prod', dryRun = false } = {}) {
	const config = syncManagedServiceSettingsFromDeployConfig(tenantRoot);
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const values = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const railwaySecretNames = registry.entries
		.filter((entry) => entry.scopes.includes(scope) && entry.targets.includes('railway-secret'))
		.map((entry) => entry.id)
		.filter((key) => typeof values[key] === 'string' && values[key].length > 0);
	const railwayVariableNames = registry.entries
		.filter((entry) => entry.scopes.includes(scope) && entry.targets.includes('railway-var'))
		.map((entry) => entry.id)
		.filter((key) => typeof values[key] === 'string' && values[key].length > 0);
	const services = ['api', 'manager', 'worker', 'workdayStart', 'workdayReport']
		.map((serviceKey) => {
			const service = deployConfig.services?.[serviceKey];
			if (!service || service.enabled === false || (service.provider ?? 'railway') !== 'railway') {
				return null;
			}
			const environment = service.environments?.[scope];
				const fallbackServiceName = serviceKey === 'api'
					? config.settings.services.railway.apiServiceName
					: '';
			const defaultRootDir = ['api', 'manager', 'worker', 'workdayStart', 'workdayReport'].includes(serviceKey) ? '.' : 'packages/core';
			return {
				service: serviceKey,
				projectName: service.railway?.projectName ?? config.settings.services.railway.projectName,
				serviceName: service.railway?.serviceName ?? fallbackServiceName,
				serviceId: service.railway?.serviceId ?? '',
				rootDir: resolve(tenantRoot, service.railway?.rootDir ?? service.rootDir ?? defaultRootDir),
				baseUrl: environment?.baseUrl ?? service.publicBaseUrl ?? '(unset)',
				environmentName: normalizeRailwayEnvironmentName(environment?.railwayEnvironment ?? scope),
				secrets: railwaySecretNames,
				variables: railwayVariableNames,
				dryRun,
			};
		})
		.filter(Boolean);

	for (const service of services) {
		for (const key of service.secrets) {
			runRailway(
				['variable', 'set', '--service', service.serviceName || service.serviceId, '--environment', service.environmentName, '--stdin', '--skip-deploys', key],
				{ cwd: service.rootDir, dryRun, input: values[key] },
			);
		}
		for (const key of service.variables) {
			runRailway(
				['variable', 'set', '--service', service.serviceName || service.serviceId, '--environment', service.environmentName, '--stdin', '--skip-deploys', key],
				{ cwd: service.rootDir, dryRun, input: values[key] },
			);
		}
	}

	return {
		scope,
		services,
	};
}

export async function initializeTreeseedPersistentEnvironment({ tenantRoot, scope = 'prod', dryRun = false } = {}) {
	const normalizedScope = scope === 'prod' ? 'prod' : scope;
	const target = createPersistentDeployTarget(normalizedScope);
	const summary = await reconcileTreeseedTarget({
		tenantRoot,
		target,
		env: process.env,
	});

	return {
		scope: normalizedScope,
		target,
		summary,
		secrets: summary.results
			.filter((result) => result.unit.provider === 'cloudflare')
			.flatMap((result) => Object.keys(result.resourceLocators ?? {})),
	};
}

async function summarizePersistentReadiness(
	tenantRoot,
	scope,
	validation,
	connectionChecks,
	env = process.env,
	{ includeReconcileStatus = true, systems }: {
		includeReconcileStatus?: boolean;
		systems?: TreeseedRunnableBootstrapSystem[];
	} = {},
) {
	const validationProblems = [...validation.missing, ...validation.invalid];
	const validationBlockers = validationProblems.map((problem) => problem.message);
	const connectionReady = connectionChecks.every((check) => check.ready || check.skipped);
	const connectionIssues = connectionChecks
		.filter((check) => !check.ready && !check.skipped)
		.map((check) => `${check.provider}: ${check.detail}`);
	const connectionWarnings = connectionChecks
		.filter((check) => check.skipped)
		.map((check) => `${check.provider}: ${check.detail}`);

	if (scope === 'local') {
		return {
			configured: validation.ok,
			provisioned: true,
			deployable: validation.ok && connectionReady,
			phase: validation.ok ? 'code_ready' : 'config_incomplete',
			blockers: [
				...validationBlockers,
				...connectionIssues,
			],
			warnings: connectionWarnings,
			checks: {
				validation: validation.ok,
				connections: connectionReady,
			},
		};
	}

	if (!validation.ok) {
		return {
			configured: false,
			provisioned: false,
			deployable: false,
			phase: 'config_incomplete',
			blockers: [
				...validationBlockers,
				...connectionIssues,
			],
			warnings: connectionWarnings,
			checks: {
				validation: false,
				connections: connectionReady,
				cloudflare: null,
				railway: false,
			},
		};
	}

	const configured = validation.ok;
	if (!includeReconcileStatus) {
		return {
			configured,
			provisioned: false,
			deployable: false,
			phase: 'config_complete',
			blockers: [...connectionIssues],
			warnings: connectionWarnings,
			checks: {
				validation: validation.ok,
				connections: connectionReady,
				reconcile: 'deferred',
			},
		};
	}

	const reconcile = await collectTreeseedReconcileStatus({
		tenantRoot,
		target: createPersistentDeployTarget(scope),
		env,
		systems,
	});
	const provisioned = reconcile.ready;
	const deployable = configured && provisioned && connectionReady;
	const blockers = [...connectionIssues, ...reconcile.blockers];
	return {
		configured,
		provisioned,
		deployable,
		phase: provisioned ? 'provisioned' : 'config_complete',
		blockers,
		warnings: [...connectionWarnings, ...reconcile.warnings],
		checks: {
			validation: validation.ok,
			connections: connectionReady,
			reconcile: reconcile.units,
		},
	};
}

function summarizeReconciledPersistentReadiness(
	scope,
	validation,
	connectionChecks,
	reconciled,
) {
	const validationProblems = [...validation.missing, ...validation.invalid];
	const validationBlockers = validationProblems.map((problem) => problem.message);
	const connectionReady = connectionChecks.every((check) => check.ready || check.skipped);
	const connectionIssues = connectionChecks
		.filter((check) => !check.ready && !check.skipped)
		.map((check) => `${check.provider}: ${check.detail}`);
	const connectionWarnings = connectionChecks
		.filter((check) => check.skipped)
		.map((check) => `${check.provider}: ${check.detail}`);
	if (scope === 'local') {
		return {
			configured: validation.ok,
			provisioned: true,
			deployable: validation.ok && connectionReady,
			phase: validation.ok ? 'code_ready' : 'config_incomplete',
			blockers: [
				...validationBlockers,
				...connectionIssues,
			],
			warnings: connectionWarnings,
			checks: {
				validation: validation.ok,
				connections: connectionReady,
			},
		};
	}
	if (!validation.ok) {
		return {
			configured: false,
			provisioned: false,
			deployable: false,
			phase: 'config_incomplete',
			blockers: [
				...validationBlockers,
				...connectionIssues,
			],
			warnings: connectionWarnings,
			checks: {
				validation: false,
				connections: connectionReady,
				reconcile: [],
			},
		};
	}
	const actions = reconciled?.actions ?? [];
	const blockers = actions
		.filter((action) => action.verified !== true)
		.flatMap((action) => [
			...action.missing.map((entry) => `${action.provider}:${action.unitType}: ${entry}`),
			...action.drifted.map((entry) => `${action.provider}:${action.unitType}: ${entry}`),
		]);
	const provisioned = blockers.length === 0 && actions.length > 0;
	return {
		configured: true,
		provisioned,
		deployable: provisioned && connectionReady,
		phase: provisioned ? 'provisioned' : 'config_complete',
		blockers: [
			...connectionIssues,
			...blockers,
		],
		warnings: connectionWarnings,
		checks: {
			validation: true,
			connections: connectionReady,
			reconcile: actions,
		},
	};
}

function formatTreeseedConfigValidationFailure(
	validations: Record<TreeseedConfigScope, ReturnType<typeof validateTreeseedEnvironmentValues>>,
	scopes: TreeseedConfigScope[],
) {
	const lines = ['Treeseed config validation failed.'];
	for (const scope of scopes) {
		const validation = validations[scope];
		if (!validation || validation.ok) {
			continue;
		}
		lines.push('');
		lines.push(`${scope}:`);
		for (const problem of [...validation.missing, ...validation.invalid]) {
			const targets = problem.entry.targets.length > 0 ? ` Targets: ${problem.entry.targets.join(', ')}.` : '';
			lines.push(`- ${problem.id}: ${problem.message}${targets}`);
		}
	}
	return lines.join('\n');
}

function colorize(value, code) {
	return `\u001b[${code}m${value}\u001b[0m`;
}

function formatConfigSectionTitle(label) {
	return colorize(`\n== ${label}`, '1;36');
}

function hasConfigValue(values, key) {
	return typeof values[key] === 'string' && values[key].trim().length > 0;
}

function createConfigReadiness(values, validation) {
	const invalidIds = new Set([
		...(validation?.invalid ?? []).map((problem) => problem.id),
	]);
	const validConfigValue = (key: string) => hasConfigValue(values, key) && !invalidIds.has(key);
	const configProblems = [
		...(validation?.missing ?? []),
		...(validation?.invalid ?? []),
	];
	const providerIssues = (provider: 'github' | 'cloudflare' | 'railway') =>
		configProblems.filter((problem) => {
			if (provider === 'github') {
				return problem.id === 'GH_TOKEN' || problem.id === 'GITHUB_TOKEN' || problem.entry.group === 'github';
			}
			if (provider === 'cloudflare') {
				return problem.id.startsWith('CLOUDFLARE_')
					|| problem.id.includes('TURNSTILE')
					|| problem.entry.group === 'cloudflare';
			}
			return problem.id.startsWith('RAILWAY_') || problem.entry.group === 'railway';
		});
	const localDevelopmentIssues = [
		...configProblems,
	].filter((problem) => problem.entry.group === 'local-development');
	return {
		github: {
			configured: validConfigValue('GH_TOKEN'),
		},
		cloudflare: {
			configured: providerIssues('cloudflare').length === 0,
		},
		railway: {
			configured: providerIssues('railway').length === 0,
		},
		localDevelopment: {
			configured: localDevelopmentIssues.length === 0,
		},
	};
}

const CONFIG_GROUP_ORDER = ['auth', 'github', 'cloudflare', 'railway', 'local-development', 'forms', 'smtp'];

export function configGroupRank(group) {
	const index = CONFIG_GROUP_ORDER.indexOf(group);
	return index === -1 ? CONFIG_GROUP_ORDER.length : index;
}

export function listRelevantTreeseedConfigEntries(registry, scope: TreeseedConfigScope) {
	return registry.entries
		.filter((entry) =>
			entry.visibility !== 'system'
			&& entry.scopes.includes(scope)
			&& (
				!entry.isRelevant
				|| entry.isRelevant(registry.context, scope, 'config')
				|| Boolean(entry.onboardingFeature)
			),
		)
		.sort((left, right) => {
			const leftRequired = isTreeseedEnvironmentEntryRequired(left, registry.context, scope, 'config');
			const rightRequired = isTreeseedEnvironmentEntryRequired(right, registry.context, scope, 'config');
			if (leftRequired !== rightRequired) {
				return leftRequired ? -1 : 1;
			}
			if (left.purposes.length !== right.purposes.length) {
				return right.purposes.length - left.purposes.length;
			}
			if (configGroupRank(left.group) !== configGroupRank(right.group)) {
				return configGroupRank(left.group) - configGroupRank(right.group);
			}
			return left.label.localeCompare(right.label);
		});
}

function buildConfigEntrySnapshot(scope: TreeseedConfigScope, entry, currentValue: string, suggestedValue: string) {
	const currentValueValid = (() => {
		if (!currentValue || !entry.validation) {
			return currentValue.length > 0;
		}
		switch (entry.validation.kind) {
			case 'string':
			case 'nonempty':
				return currentValue.trim().length > 0
					&& (
						typeof entry.validation.minLength !== 'number'
						|| currentValue.trim().length >= entry.validation.minLength
					);
			case 'boolean':
				return /^(true|false|1|0)$/i.test(currentValue);
			case 'number':
				return Number.isFinite(Number(currentValue));
			case 'url':
				try {
					new URL(currentValue);
					return true;
				} catch {
					return false;
				}
			case 'email':
				return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentValue);
			case 'enum':
				return entry.validation.values.includes(currentValue);
			default:
				return true;
		}
	})();
	const allowSuggestedDefault = !(entry.sensitivity === 'secret' && entry.requirement !== 'optional');
	const effectiveValue = currentValueValid
		? (currentValue || (allowSuggestedDefault ? suggestedValue : '') || '')
		: ((allowSuggestedDefault ? suggestedValue : '') || currentValue || '');
	return {
		id: entry.id,
		label: entry.label,
		group: entry.group,
		cluster: entry.cluster ?? `${entry.group}:${entry.id}`,
		startupProfile: entry.startupProfile ?? 'advanced',
		requirement: entry.requirement,
		description: entry.description,
		howToGet: entry.howToGet,
		sensitivity: entry.sensitivity,
		targets: [...entry.targets],
		purposes: [...entry.purposes],
		storage: entry.storage ?? 'scoped',
		validation: entry.validation,
		scope,
		sharedScopes: entry.storage === 'shared' ? [...entry.scopes] : [scope],
		required: false,
		currentValue,
		suggestedValue,
		effectiveValue,
	} satisfies TreeseedConfigEntrySnapshot;
}

export function collectTreeseedConfigContext({
	tenantRoot,
	scopes = [...TREESEED_ENVIRONMENT_SCOPES],
	env = process.env,
}: {
	tenantRoot: string;
	scopes?: TreeseedConfigScope[];
	env?: NodeJS.ProcessEnv;
}): TreeseedCollectedConfigContext {
	ensureTreeseedGitignoreEntries(tenantRoot);
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const valuesByScope = Object.fromEntries(
		scopes.map((scope) => [scope, collectTreeseedConfigSeedValues(tenantRoot, scope, env)]),
	) as TreeseedCollectedConfigContext['valuesByScope'];
	const suggestedValuesByScope = Object.fromEntries(
		scopes.map((scope) => [scope, getTreeseedEnvironmentSuggestedValues({
			scope,
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
			values: valuesByScope[scope],
		})]),
	) as TreeseedCollectedConfigContext['suggestedValuesByScope'];
	const validationByScope = Object.fromEntries(
		scopes.map((scope) => [scope, validateTreeseedEnvironmentValues({
			values: {
				...suggestedValuesByScope[scope],
				...valuesByScope[scope],
			},
			scope,
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
		})]),
	) as TreeseedCollectedConfigContext['validationByScope'];
	const configReadinessByScope = Object.fromEntries(
		scopes.map((scope) => [scope, createConfigReadiness(valuesByScope[scope], validationByScope[scope])]),
	) as TreeseedCollectedConfigContext['configReadinessByScope'];
	const entriesByScope = Object.fromEntries(
		scopes.map((scope) => [scope, listRelevantTreeseedConfigEntries(registry, scope).map((entry) => ({
			...buildConfigEntrySnapshot(
				scope,
				entry,
				valuesByScope[scope][entry.id] ?? '',
				suggestedValuesByScope[scope][entry.id] ?? '',
			),
			required: isTreeseedEnvironmentEntryRequired(entry, registry.context, scope, 'config'),
		}))]),
	) as TreeseedCollectedConfigContext['entriesByScope'];

	return {
		tenantRoot,
		scopes,
		project: {
			name: registry.context.deployConfig.name,
			slug: registry.context.deployConfig.slug,
			siteUrl: registry.context.deployConfig.siteUrl,
		},
		configPath,
		keyPath,
		entriesByScope,
		valuesByScope,
		suggestedValuesByScope,
		configReadinessByScope,
		validationByScope,
		sharedStorageMigrations: [],
		registry,
	};
}

export function applyTreeseedConfigValues({
	tenantRoot,
	updates,
	applyLocalEnvironment = true,
}: {
	tenantRoot: string;
	updates: TreeseedConfigValueUpdate[];
	applyLocalEnvironment?: boolean;
}) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const key = loadMachineKey(tenantRoot);
	const machineConfig = loadTreeseedMachineConfig(tenantRoot);
	const sharedStorageMigrations = migrateLegacyScopedSharedEntries(tenantRoot, machineConfig, registry.entries, key);
	const entryById = new Map(registry.entries.map((entry) => [entry.id, entry]));
	const applied: Array<{ scope: TreeseedConfigScope | 'shared'; id: string; reused: boolean; cleared: boolean }> = [];

	for (const update of updates) {
		const entry = entryById.get(update.entryId);
		if (!entry) {
			throw new Error(`Unknown Treeseed config entry "${update.entryId}".`);
		}
		if (!entry.scopes.includes(update.scope)) {
			throw new Error(`Treeseed config entry "${update.entryId}" does not apply to ${update.scope}.`);
		}

		setTreeseedMachineEnvironmentValue(tenantRoot, update.scope, entry, update.value);
		applied.push({
			scope: entry.storage === 'shared' ? 'shared' : update.scope,
			id: entry.id,
			reused: update.reused === true,
			cleared: update.value.length === 0,
		});
	}

	if (applyLocalEnvironment) {
		applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'local', override: true });
	}

	return {
		updated: applied,
		sharedStorageMigrations,
	};
}

function configProblemBootstrapSystems(problem) {
	switch (problem?.id) {
		case 'GH_TOKEN':
		case 'GITHUB_TOKEN':
			return ['github'];
		case 'CLOUDFLARE_API_TOKEN':
		case 'CLOUDFLARE_ACCOUNT_ID':
		case 'CLOUDFLARE_ZONE_ID':
			return ['data', 'web'];
		case 'RAILWAY_API_TOKEN':
		case 'TREESEED_RAILWAY_WORKSPACE':
			return ['api', 'agents'];
		default:
			return null;
	}
}

function filterValidationForBootstrapSystems(validation, runnableSystems: TreeseedRunnableBootstrapSystem[]) {
	const runnable = new Set(runnableSystems);
	const keepProblem = (problem) => {
		const systems = configProblemBootstrapSystems(problem);
		return !systems || systems.some((system) => runnable.has(system));
	};
	const missing = validation.missing.filter(keepProblem);
	const invalid = validation.invalid.filter(keepProblem);
	return {
		...validation,
		ok: missing.length === 0 && invalid.length === 0,
		missing,
		invalid,
	};
}

export async function finalizeTreeseedConfig({
	tenantRoot,
	scopes = [...TREESEED_ENVIRONMENT_SCOPES],
	sync = 'all',
	env = process.env,
	checkConnections = true,
	initializePersistent = true,
	systems,
	skipUnavailable,
	bootstrapExecution = 'parallel',
	onProgress,
}: {
	tenantRoot: string;
	scopes?: TreeseedConfigScope[];
	sync?: 'none' | 'github' | 'cloudflare' | 'railway' | 'all';
	env?: NodeJS.ProcessEnv;
	checkConnections?: boolean;
	initializePersistent?: boolean;
	systems?: TreeseedBootstrapSystem[] | TreeseedBootstrapSystem;
	skipUnavailable?: boolean;
	bootstrapExecution?: 'parallel' | 'sequential';
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
}) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const summary = {
		scopes,
		synced: {} as Record<string, unknown>,
		reconciled: [] as Array<{ scope: TreeseedConfigScope; target: string; units: number; actions: Array<{ unitId: string; unitType: string; provider: string; action: string; verified: boolean; missing: string[]; drifted: string[] }> }>,
		deployed: [] as Array<{ scope: TreeseedConfigScope; branchBootstrap?: Record<string, unknown> | null; result: Record<string, unknown> }>,
		resourceInventoryByScope: {} as Record<TreeseedConfigScope, Record<string, unknown>>,
		connectionChecks: [] as ReturnType<typeof checkTreeseedProviderConnections>[],
		validationByScope: {} as Record<TreeseedConfigScope, ReturnType<typeof validateTreeseedEnvironmentValues>>,
		bootstrapSystemsByScope: {} as Record<TreeseedConfigScope, ReturnType<typeof resolveTreeseedBootstrapSelection>>,
		githubRepository: null as Record<string, unknown> | null,
		readinessByScope: {} as Record<TreeseedConfigScope, {
			phase: string;
			configured: boolean;
			provisioned: boolean;
			deployable: boolean;
			blockers: string[];
			warnings: string[];
			checks: Record<string, unknown>;
		}>,
		bootstrapExecution,
	};
	const progress = (message: string, stream: 'stdout' | 'stderr' = 'stdout') => {
		if (typeof onProgress === 'function') {
			onProgress(message, stream);
		}
	};

	progress(`Validating configuration for ${scopes.join(', ')}...`);
	const scopeSeedValues = Object.fromEntries(
		scopes.map((scope) => [scope, collectTreeseedConfigSeedValues(tenantRoot, scope, env)]),
	) as Record<TreeseedConfigScope, Record<string, string>>;

	for (const scope of scopes) {
		const selection = resolveTreeseedBootstrapSelection({
			deployConfig: registry.context.deployConfig,
			env: scopeSeedValues[scope],
			systems: scope === 'local' ? ['github'] : systems,
			skipUnavailable: scope === 'local' ? true : skipUnavailable,
		});
		summary.bootstrapSystemsByScope[scope] = selection;
		const strictUnavailable = selection.unavailable.filter((status) =>
			!selection.skipped.some((skipped) => skipped.system === status.system && skipped.reason === status.reason),
		);
		if (initializePersistent && strictUnavailable.length > 0) {
			throw new Error(`Treeseed bootstrap cannot run the selected systems for ${scope}:\n- ${strictUnavailable.map((status) => `${status.system}: ${status.reason}`).join('\n- ')}`);
		}
		for (const skipped of selection.skipped) {
			progress(`[${scope}][${skipped.system}][skip] ${skipped.reason}`);
		}
	}

	for (const scope of scopes) {
		const seedValues = scopeSeedValues[scope];
		const suggestedValues = getTreeseedEnvironmentSuggestedValues({
			scope,
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
			values: seedValues,
		});
		const validation = validateTreeseedEnvironmentValues({
			values: {
				...suggestedValues,
				...seedValues,
			},
			scope,
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
		});
		summary.validationByScope[scope] = initializePersistent
			? filterValidationForBootstrapSystems(validation, summary.bootstrapSystemsByScope[scope].runnable)
			: validation;

		if (checkConnections) {
			progress(`Checking provider connectivity for ${scope}...`);
			summary.connectionChecks.push(await checkTreeseedProviderConnections({ tenantRoot, scope, env: seedValues }));
		}
	}

	for (const scope of scopes) {
		if (scope !== 'local') {
			const target = createPersistentDeployTarget(scope);
			const deployState = loadDeployState(tenantRoot, registry.context.deployConfig, { target });
			const inventory = buildProvisioningSummary(registry.context.deployConfig, deployState, target);
			const railwayWorkspace = resolveRailwayWorkspace(scopeSeedValues[scope]);
			summary.resourceInventoryByScope[scope] = inventory;
			progress(
				`Resolved ${scope} resources: deployment=${inventory.identity?.deploymentKey}, pages=${inventory.resources?.pagesProject}, web-domain=${inventory.resources?.webDomain ?? '(none)'}, api-domain=${inventory.resources?.apiDomain ?? '(none)'}, r2=${inventory.resources?.contentBucket}, queue=${inventory.resources?.queue}, d1=${inventory.resources?.database}, railway=${inventory.resources?.railwayProject}, workspace=${railwayWorkspace}.`,
			);
		}
		summary.readinessByScope[scope] = await summarizePersistentReadiness(
			tenantRoot,
			scope,
			summary.validationByScope[scope],
			summary.connectionChecks.find((report) => report.scope === scope)?.checks ?? [],
			scopeSeedValues[scope],
			{
				includeReconcileStatus: initializePersistent
					&& summary.bootstrapSystemsByScope[scope].runnable.some((system) => system !== 'github'),
				systems: summary.bootstrapSystemsByScope[scope].runnable.filter((system) => system !== 'github'),
			},
		);
	}

	const invalidScopes = scopes.filter((scope) => summary.validationByScope[scope]?.ok !== true);
	if (invalidScopes.length > 0) {
		throw new Error(formatTreeseedConfigValidationFailure(summary.validationByScope, scopes));
	}
	const failingConnectionReports = summary.connectionChecks.filter((report) => report.ok !== true);
	if (failingConnectionReports.length > 0) {
		throw new Error(formatTreeseedProviderConnectionFailures(failingConnectionReports));
	}

	progress('Syncing managed service settings from treeseed.site.yaml...');
	syncManagedServiceSettingsFromDeployConfig(tenantRoot);

	const githubSelected = scopes.some((scope) => scope !== 'local' && summary.bootstrapSystemsByScope[scope].runnable.includes('github'));
	let githubRepository = maybeResolveGitHubRepositorySlug(tenantRoot);
	if (githubSelected && initializePersistent) {
		const localSeedValues = collectTreeseedConfigSeedValues(tenantRoot, 'local', env);
		const localSuggestedValues = getTreeseedEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
			values: localSeedValues,
		});
		const repositoryBootstrap = await ensureGitHubBootstrapRepository(tenantRoot, {
			values: {
				...localSuggestedValues,
				...localSeedValues,
			},
			defaultName: registry.context.deployConfig.slug,
			onProgress: (line) => progress(line),
		});
		summary.githubRepository = repositoryBootstrap as Record<string, unknown>;
		githubRepository = repositoryBootstrap.repository;
	}

	if (initializePersistent) {
		for (const scope of scopes) {
			if (scope === 'local') {
				continue;
			}
			const selection = summary.bootstrapSystemsByScope[scope];
			const reconcileSystems = selection.runnable.filter((system) => system !== 'github');
			if (reconcileSystems.length > 0) {
				progress(`[${scope}][bootstrap][plan] Deriving desired units for ${reconcileSystems.join(', ')}...`);
				const initialized = await reconcileTreeseedTarget({
					tenantRoot,
					target: createPersistentDeployTarget(scope),
					env: scopeSeedValues[scope],
					systems: reconcileSystems,
					write: (line) => progress(`[${scope}][reconcile] ${line}`),
				});
				summary.reconciled.push({
					scope,
					target: scope,
					units: initialized.units.length,
					actions: initialized.results.map((result) => ({
						unitId: result.unit.unitId,
						unitType: result.unit.unitType,
						provider: result.unit.provider,
						action: result.action,
						verified: result.verification?.verified === true,
						missing: result.verification?.missing ?? [],
						drifted: result.verification?.drifted ?? [],
					})),
				});
			}
			if (scope === 'staging' && selection.runnable.includes('github')) {
				progress(`[${scope}][github][branch] Ensuring ${STAGING_BRANCH} exists on origin from ${PRODUCTION_BRANCH}...`);
				if (!githubRepository) {
					throw new Error('Unable to determine the GitHub repository from the origin remote for staging branch bootstrap.');
				}
				const branchBootstrap = await ensureGitHubBranchFromBase(githubRepository, STAGING_BRANCH, {
					baseBranch: PRODUCTION_BRANCH,
					client: createGitHubApiClient({
						env: scopeSeedValues[scope],
					}),
				});
				summary.deployed.push({
					scope,
					branchBootstrap,
					result: {},
				});
			}
			const deploySystems = selection.runnable.filter((system) => system === 'data' || system === 'web' || system === 'api' || system === 'agents');
			if (deploySystems.length > 0) {
				progress(`[${scope}][bootstrap][deploy] Deploying ${deploySystems.join(', ')}...`);
				applyTreeseedEnvironmentToProcess({ tenantRoot, scope, override: true });
				process.env.TREESEED_RAILWAY_WORKSPACE = process.env.TREESEED_RAILWAY_WORKSPACE
					|| scopeSeedValues[scope].TREESEED_RAILWAY_WORKSPACE
					|| resolveRailwayWorkspace(scopeSeedValues[scope]);
				const { deployProjectPlatform } = await import('./project-platform.ts');
				const deployResult = await deployProjectPlatform({
					tenantRoot,
					scope,
					skipProvision: true,
					bootstrapSystems: deploySystems,
					bootstrapExecution,
					env: scopeSeedValues[scope],
					write: (line, stream) => progress(line, stream),
				});
				const deployEntry = summary.deployed.find((entry) => entry.scope === scope);
				if (deployEntry) {
					deployEntry.result = deployResult as Record<string, unknown>;
				} else {
					summary.deployed.push({
						scope,
						branchBootstrap: null,
						result: deployResult as Record<string, unknown>,
					});
				}
				progress(`[${scope}][bootstrap][verify] Re-verifying after deployment...`);
				const finalized = await reconcileTreeseedTarget({
					tenantRoot,
					target: createPersistentDeployTarget(scope),
					env: scopeSeedValues[scope],
					systems: reconcileSystems,
					write: (line) => progress(`[${scope}][verify] ${line}`),
				});
				const index = summary.reconciled.findIndex((entry) => entry.scope === scope);
				const nextSummary = {
					scope,
					target: scope,
					units: finalized.units.length,
					actions: finalized.results.map((result) => ({
						unitId: result.unit.unitId,
						unitType: result.unit.unitType,
						provider: result.unit.provider,
						action: result.action,
						verified: result.verification?.verified === true,
						missing: result.verification?.missing ?? [],
						drifted: result.verification?.drifted ?? [],
					})),
				};
				if (index >= 0) {
					summary.reconciled[index] = nextSummary;
				} else {
					summary.reconciled.push(nextSummary);
				}
			}
		}
	}

	if (sync === 'github' || sync === 'all') {
		const githubScopes = scopes.filter((scope) => scope !== 'local' && summary.bootstrapSystemsByScope[scope].runnable.includes('github'));
		const syncScope = async (scope: TreeseedConfigScope) => {
			progress(`[${scope}][github][sync] Syncing GitHub environment...`);
			return await syncTreeseedGitHubEnvironment({
				tenantRoot,
				scope,
				repository: githubRepository,
				execution: bootstrapExecution,
				onProgress: progress,
			});
		};
		const githubResults: Array<Awaited<ReturnType<typeof syncTreeseedGitHubEnvironment>>> = [];
		if (bootstrapExecution === 'sequential') {
			for (const scope of githubScopes) {
				githubResults.push(await syncScope(scope));
			}
		} else {
			githubResults.push(...await Promise.all(githubScopes.map((scope) => syncScope(scope))));
		}
		summary.synced.github = {
			scopes: githubResults,
			repository: githubResults[0]?.repository ?? githubRepository ?? maybeResolveGitHubRepositorySlug(tenantRoot),
			secrets: githubResults.flatMap((entry) => entry.secrets),
			variables: githubResults.flatMap((entry) => entry.variables),
		};
	}
	for (const scope of scopes) {
		const reconciled = summary.reconciled.find((entry) => entry.scope === scope) ?? null;
		summary.readinessByScope[scope] = initializePersistent && reconciled
			? summarizeReconciledPersistentReadiness(
				scope,
				summary.validationByScope[scope],
				summary.connectionChecks.find((report) => report.scope === scope)?.checks ?? [],
				reconciled,
			)
			: await summarizePersistentReadiness(
				tenantRoot,
				scope,
				summary.validationByScope[scope],
				summary.connectionChecks.find((report) => report.scope === scope)?.checks ?? [],
				scopeSeedValues[scope],
				{
					includeReconcileStatus: initializePersistent
						&& summary.bootstrapSystemsByScope[scope].runnable.some((system) => system !== 'github'),
					systems: summary.bootstrapSystemsByScope[scope].runnable.filter((system) => system !== 'github'),
				},
			);
	}

	return summary;
}

export function collectTreeseedPrintEnvReport({
	tenantRoot,
	scope,
	env = process.env,
	revealSecrets = false,
}: {
	tenantRoot: string;
	scope: TreeseedConfigScope;
	env?: NodeJS.ProcessEnv;
	revealSecrets?: boolean;
}) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const { values, sources } = collectTreeseedConfigSeedValueSources(tenantRoot, scope, env);
	return {
		scope,
		revealSecrets,
		entries: listRelevantTreeseedConfigEntries(registry, scope).map((entry) => {
			const rawValue = values[entry.id] ?? '';
			return {
				id: entry.id,
				label: entry.label,
				sensitivity: entry.sensitivity,
				value: rawValue,
				displayValue: rawValue
					? (entry.sensitivity === 'secret' && !revealSecrets ? maskValue(rawValue) : rawValue)
					: '(unset)',
				source: sources[entry.id] ?? 'unset',
			};
		}),
	};
}
