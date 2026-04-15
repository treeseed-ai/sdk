import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ApiPrincipal, RemoteTreeseedConfig, RemoteTreeseedHost } from '../../remote.ts';
import {
	getTreeseedEnvironmentSuggestedValues,
	isTreeseedEnvironmentEntryRequired,
	resolveTreeseedEnvironmentRegistry,
	TREESEED_ENVIRONMENT_SCOPES,
	validateTreeseedEnvironmentValues,
} from '../../platform/environment.ts';
import { loadTreeseedManifest } from '../../platform/tenant-config.ts';
import {
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
	loadDeployState,
	markManagedServicesInitialized,
	markDeploymentInitialized,
	provisionCloudflareResources,
	syncCloudflareSecrets,
} from './deploy.ts';
import { maybeResolveGitHubRepositorySlug } from './github-automation.ts';
import { loadCliDeployConfig, resolveWranglerBin, withProcessCwd } from './runtime-tools.ts';

const MACHINE_CONFIG_RELATIVE_PATH = '.treeseed/config/machine.yaml';
const MACHINE_KEY_HOME_RELATIVE_PATH = '.treeseed/config/machine.key';
const LEGACY_MACHINE_KEY_RELATIVE_PATH = '.treeseed/config/machine.key';
const REMOTE_AUTH_RELATIVE_PATH = '.treeseed/config/remote-auth.json';
const TEMPLATE_CATALOG_CACHE_RELATIVE_PATH = 'treeseed/cache/template-catalog.json';
const TENANT_ENVIRONMENT_OVERLAY_PATH = 'src/env.yaml';
const CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER = 'replace-with-cloudflare-account-id';
export const DEFAULT_TREESEED_API_BASE_URL = 'https://api.treeseed.ai';
export const DEFAULT_TEMPLATE_CATALOG_URL = 'https://api.treeseed.ai/search/templates';
export const TREESEED_TEMPLATE_CATALOG_URL_ENV = 'TREESEED_TEMPLATE_CATALOG_URL';
export const TREESEED_API_BASE_URL_ENV = 'TREESEED_API_BASE_URL';

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
			agentsServiceId: '',
			agentsServiceName: '',
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
			agentsServiceId: typeof railway.agentsServiceId === 'string' ? railway.agentsServiceId : '',
			agentsServiceName: typeof railway.agentsServiceName === 'string' ? railway.agentsServiceName : '',
		},
	};
}

function ensureParent(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

function parseEnvFile(contents) {
	return contents
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'))
		.reduce((acc, line) => {
			const separatorIndex = line.indexOf('=');
			if (separatorIndex === -1) {
				return acc;
			}
			acc[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1);
			return acc;
		}, {});
}

function readEnvFileIfPresent(filePath) {
	if (!existsSync(filePath)) {
		return {};
	}
	return parseEnvFile(readFileSync(filePath, 'utf8'));
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
		?? deployConfig.services?.agents?.railway?.projectId
		?? railway.projectId;
	railway.projectName = deployConfig.services?.api?.railway?.projectName
		?? deployConfig.services?.agents?.railway?.projectName
		?? railway.projectName;
	railway.apiServiceId = deployConfig.services?.api?.railway?.serviceId ?? railway.apiServiceId;
	railway.apiServiceName = deployConfig.services?.api?.railway?.serviceName ?? railway.apiServiceName;
	railway.agentsServiceId = deployConfig.services?.agents?.railway?.serviceId ?? railway.agentsServiceId;
	railway.agentsServiceName = deployConfig.services?.agents?.railway?.serviceName ?? railway.agentsServiceName;

	const remote = normalizeRemoteSettings(config.settings.remote);
	const defaultHostBaseUrl = deployConfig.services?.api?.environments?.prod?.baseUrl
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
	description: string;
	howToGet: string;
	sensitivity: 'secret' | 'plain' | 'derived';
	targets: string[];
	purposes: string[];
	storage: 'shared' | 'scoped';
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
	authStatusByScope: Record<TreeseedConfigScope, ReturnType<typeof createConfigAuthStatus>>;
	validationByScope: Record<TreeseedConfigScope, ReturnType<typeof validateTreeseedEnvironmentValues>>;
	registry: ReturnType<typeof collectTreeseedEnvironmentContext>;
};

export type TreeseedConfigValueUpdate = {
	scope: TreeseedConfigScope;
	entryId: string;
	value: string;
	reused?: boolean;
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

function readMachineKey(keyPath) {
	if (existsSync(keyPath)) {
		return Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
	}
	return null;
}

function writeMachineKey(keyPath, key) {
	ensureParent(keyPath);
	writeFileSync(keyPath, `${key.toString('base64')}\n`, { mode: 0o600 });
}

function ensureHomeMachineKey(tenantRoot) {
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const existing = readMachineKey(keyPath);
	if (existing) {
		return existing;
	}
	const key = randomBytes(32);
	writeMachineKey(keyPath, key);
	return key;
}

function loadLegacyMachineKey(tenantRoot) {
	const { legacyKeyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	return readMachineKey(legacyKeyPath);
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

function ensureTreeseedMachineKeyMigrated(tenantRoot) {
	const homeKey = ensureHomeMachineKey(tenantRoot);
	const legacyKey = loadLegacyMachineKey(tenantRoot);
	if (!legacyKey) {
		return homeKey;
	}

	try {
		reencryptTreeseedEncryptedState(tenantRoot, legacyKey, homeKey);
		removeLegacyMachineKeyIfSafe(tenantRoot);
	} catch {
		// Keep the legacy key for reads if the project state was already encrypted with the home key.
	}

	return homeKey;
}

function loadMachineKey(tenantRoot) {
	return ensureTreeseedMachineKeyMigrated(tenantRoot);
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
	writeMachineKey(keyPath, newKey);
	removeLegacyMachineKeyIfSafe(tenantRoot);

	return {
		keyPath,
		rotated: true,
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
	const deployBaseUrl = deployConfig?.services?.api?.environments?.prod?.baseUrl
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
	const requiredEntries = ['.env.local', '.dev.vars', '.treeseed/'];
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

	const envLocalPath = resolve(tenantRoot, '.env.local');
	const envLocalExamplePath = resolve(tenantRoot, '.env.local.example');
	if (!existsSync(envLocalPath) && existsSync(envLocalExamplePath)) {
		copyFileSync(envLocalExamplePath, envLocalPath);
		actions.push({ id: 'env-local', detail: 'Created .env.local from .env.local.example.' });
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

	resolveTreeseedMachineEnvironmentValues(tenantRoot, 'local');
	actions.push({ id: 'machine-key', detail: 'Ensured the Treeseed machine key exists.' });

	const machineConfig = loadTreeseedMachineConfig(tenantRoot);
	writeTreeseedMachineConfig(tenantRoot, machineConfig);
	writeTreeseedLocalEnvironmentFiles(tenantRoot);
	actions.push({ id: 'local-env', detail: 'Regenerated .env.local and .dev.vars from the current machine config.' });

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
	const knownKeys = new Set([
		...Object.keys(bucketValuesByScope.shared ?? {}),
		...Object.keys(bucketValuesByScope[scope] ?? {}),
		...registry.entries.map((entry) => entry.id),
	]);

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
	return {
		...readEnvFileIfPresent(resolve(tenantRoot, '.env.local')),
		...readEnvFileIfPresent(resolve(tenantRoot, '.dev.vars')),
		...Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value ?? undefined])),
		...resolveTreeseedMachineEnvironmentValues(tenantRoot, scope),
	};
}

function collectTreeseedConfigSeedValueSources(tenantRoot, scope, env = process.env) {
	const values = {};
	const sources = {};
	const merge = (source, entries) => {
		for (const [key, value] of Object.entries(entries)) {
			if (typeof value !== 'string' || value.length === 0) {
				continue;
			}
			values[key] = value;
			sources[key] = source;
		}
	};

	merge('.env.local', readEnvFileIfPresent(resolve(tenantRoot, '.env.local')));
	merge('.dev.vars', readEnvFileIfPresent(resolve(tenantRoot, '.dev.vars')));
	merge('process.env', Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value ?? undefined])));
	merge('machine-config', resolveTreeseedMachineEnvironmentValues(tenantRoot, scope));

	return { values, sources };
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
	const resolvedValues = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
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
	const machineValues = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	const values = {
		...machineValues,
		...Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, value ?? undefined])),
	};
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

function renderEnvEntries(entries, values) {
	return entries
		.map((entry) => [entry.id, values[entry.id]])
		.filter(([, value]) => typeof value === 'string' && value.length > 0)
		.map(([key, value]) => `${key}=${value}`)
		.join('\n');
}

export function writeTreeseedLocalEnvironmentFiles(tenantRoot) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const scope = 'local';
	const values = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	const orderedEntries = listRelevantTreeseedConfigEntries(registry, scope);

	const envEntries = orderedEntries.filter(
		(entry) =>
			entry.scopes.includes(scope)
			&& entry.targets.includes('local-file'),
	);
	const devVarsEntries = orderedEntries.filter(
		(entry) =>
			entry.scopes.includes(scope)
			&& entry.targets.includes('wrangler-dev-vars'),
	);

	writeFileSync(resolve(tenantRoot, '.env.local'), `${renderEnvEntries(envEntries, values)}\n`, 'utf8');
	writeFileSync(resolve(tenantRoot, '.dev.vars'), `${renderEnvEntries(devVarsEntries, values)}\n`, 'utf8');

	return {
		envLocalPath: resolve(tenantRoot, '.env.local'),
		devVarsPath: resolve(tenantRoot, '.dev.vars'),
	};
}

function runGh(args, { cwd, dryRun = false, input } = {}) {
	if (dryRun) {
		return { status: 0, stdout: '', stderr: '' };
	}
	const result = spawnSync('gh', args, {
		cwd,
		stdio: input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
		input,
	});
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
	});
	return {
		ok: result.status === 0,
		status: result.status ?? 1,
		stdout: result.stdout?.trim() ?? '',
		stderr: result.stderr?.trim() ?? '',
		detail: `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim(),
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

	return {
		githubCli,
		ghActExtension,
		dockerDaemon,
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
	const result = spawnSync('gh', args, {
		cwd: tenantRoot,
		stdio: 'pipe',
		encoding: 'utf8',
		env: { ...process.env, ...env },
	});
	if (result.status !== 0) {
		return providerConnectionResult('github', false, formatCheckOutput(result) || 'GitHub API check failed.');
	}
	const resolved = result.stdout.trim();
	return providerConnectionResult(
		'github',
		true,
		repository
			? `GitHub token can access ${resolved || repository}.`
			: resolved ? `Authenticated as ${resolved}.` : 'GitHub API check succeeded.',
	);
}

function checkCloudflareConnection({ tenantRoot, env }) {
	if (!env.CLOUDFLARE_API_TOKEN) {
		return providerConnectionResult('cloudflare', false, 'CLOUDFLARE_API_TOKEN is not configured.', { skipped: true });
	}
	try {
		const result = spawnSync(process.execPath, [resolveWranglerBin(), 'whoami'], {
			cwd: tenantRoot,
			stdio: 'pipe',
			encoding: 'utf8',
			env: { ...process.env, ...env },
		});
		if (result.status !== 0) {
			return providerConnectionResult('cloudflare', false, formatCheckOutput(result) || 'Cloudflare Wrangler check failed.');
		}
		return providerConnectionResult('cloudflare', true, 'Wrangler authenticated with CLOUDFLARE_API_TOKEN.');
	} catch (error) {
		return providerConnectionResult('cloudflare', false, error instanceof Error ? error.message : 'Cloudflare Wrangler check failed.');
	}
}

function checkRailwayConnection({ tenantRoot, env }) {
	if (!env.RAILWAY_API_TOKEN && !env.RAILWAY_TOKEN) {
		return providerConnectionResult('railway', false, 'RAILWAY_API_TOKEN or RAILWAY_TOKEN is not configured.', { skipped: true });
	}
	if (!commandAvailable('railway')) {
		return providerConnectionResult('railway', false, 'Railway CLI `railway` is not installed.');
	}
	const result = spawnSync('railway', ['whoami'], {
		cwd: tenantRoot,
		stdio: 'pipe',
		encoding: 'utf8',
		env: { ...process.env, ...env },
	});
	if (result.status !== 0) {
		return providerConnectionResult('railway', false, formatCheckOutput(result) || 'Railway CLI check failed.');
	}
	return providerConnectionResult('railway', true, result.stdout.trim() || 'Railway CLI check succeeded.');
}

export function checkTreeseedProviderConnections({ tenantRoot, scope = 'prod', env = process.env } = {}) {
	const values = collectTreeseedConfigSeedValues(tenantRoot, scope, env);
	const commandEnv = {
		GH_TOKEN: values.GH_TOKEN,
		CLOUDFLARE_API_TOKEN: values.CLOUDFLARE_API_TOKEN,
		CLOUDFLARE_ACCOUNT_ID: values.CLOUDFLARE_ACCOUNT_ID,
		RAILWAY_API_TOKEN: values.RAILWAY_API_TOKEN,
		RAILWAY_TOKEN: values.RAILWAY_TOKEN,
	};
	const checks = [
		checkGitHubConnection({ tenantRoot, env: commandEnv }),
		checkCloudflareConnection({ tenantRoot, env: commandEnv }),
		checkRailwayConnection({ tenantRoot, env: commandEnv }),
	];
	return {
		scope,
		ok: checks.every((check) => check.ready || check.skipped),
		checks,
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

function writeProviderConnectionReport(write, report) {
	write(formatTreeseedProviderConnectionReport(report));
}

function listGitHubNames(command, repository, tenantRoot) {
	const result = runGh([command, 'list', '--repo', repository, '--json', 'name'], { cwd: tenantRoot });
	return new Set((JSON.parse(result.stdout || '[]')).map((entry) => entry?.name).filter(Boolean));
}

export function syncTreeseedGitHubEnvironment({ tenantRoot, scope = 'prod', dryRun = false } = {}) {
	const repository = maybeResolveGitHubRepositorySlug(tenantRoot);
	if (!repository) {
		throw new Error('Unable to determine the GitHub repository from the origin remote.');
	}

	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const values = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	const relevant = registry.entries.filter((entry) => entry.scopes.includes(scope));
	const secretNames = listGitHubNames('secret', repository, tenantRoot);
	const variableNames = listGitHubNames('variable', repository, tenantRoot);
	const synced = {
		secrets: [],
		variables: [],
	};

	for (const entry of relevant) {
		const value = values[entry.id];
		if (!value) {
			continue;
		}

		if (entry.targets.includes('github-secret')) {
			runGh(['secret', 'set', entry.id, '--repo', repository, '--body', value], { cwd: tenantRoot, dryRun });
			synced.secrets.push({ name: entry.id, existed: secretNames.has(entry.id) });
		}

		if (entry.targets.includes('github-variable')) {
			runGh(['variable', 'set', entry.id, '--repo', repository, '--body', value], { cwd: tenantRoot, dryRun });
			synced.variables.push({ name: entry.id, existed: variableNames.has(entry.id) });
		}
	}

	return {
		repository,
		scope,
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
	const services = ['api', 'agents', 'manager', 'worker', 'runner', 'workdayStart', 'workdayReport']
		.map((serviceKey) => {
			const service = deployConfig.services?.[serviceKey];
			if (!service || service.enabled === false || (service.provider ?? 'railway') !== 'railway') {
				return null;
			}
			const environment = service.environments?.[scope];
			const fallbackServiceName =
				serviceKey === 'api'
					? config.settings.services.railway.apiServiceName
					: serviceKey === 'agents'
						? config.settings.services.railway.agentsServiceName
						: '';
			const defaultRootDir = ['api', 'manager', 'worker', 'runner', 'workdayStart', 'workdayReport'].includes(serviceKey) ? '.' : 'packages/core';
			return {
				service: serviceKey,
				projectName: service.railway?.projectName ?? config.settings.services.railway.projectName,
				serviceName: service.railway?.serviceName ?? fallbackServiceName,
				serviceId: service.railway?.serviceId ?? '',
				rootDir: resolve(tenantRoot, service.railway?.rootDir ?? service.rootDir ?? defaultRootDir),
				baseUrl: environment?.baseUrl ?? service.publicBaseUrl ?? '(unset)',
				environmentName: environment?.railwayEnvironment ?? scope,
				secrets: railwaySecretNames,
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
	}

	return {
		scope,
		services,
	};
}

export function initializeTreeseedPersistentEnvironment({ tenantRoot, scope = 'prod', dryRun = false } = {}) {
	const normalizedScope = scope === 'prod' ? 'prod' : scope;
	const target = createPersistentDeployTarget(normalizedScope);
	const summary = provisionCloudflareResources(tenantRoot, { dryRun, target });
	ensureGeneratedWranglerConfig(tenantRoot, { target });
	const syncedSecrets = syncCloudflareSecrets(tenantRoot, { dryRun, target });
	if (!dryRun) {
		markDeploymentInitialized(tenantRoot, { target });
	}

	return {
		scope: normalizedScope,
		target,
		summary,
		secrets: syncedSecrets,
	};
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

function createConfigAuthStatus(values) {
	const ghReady = hasConfigValue(values, 'GH_TOKEN');
	return {
		gh: {
			authenticated: ghReady,
		},
		wrangler: {
			authenticated: hasConfigValue(values, 'CLOUDFLARE_API_TOKEN'),
		},
		railway: {
			authenticated: hasConfigValue(values, 'RAILWAY_API_TOKEN'),
		},
		copilot: {
			configured: ghReady,
		},
	};
}

const CONFIG_GROUP_ORDER = ['auth', 'cloudflare', 'local-development', 'forms', 'smtp'];

function configGroupRank(group) {
	const index = CONFIG_GROUP_ORDER.indexOf(group);
	return index === -1 ? CONFIG_GROUP_ORDER.length : index;
}

export function listRelevantTreeseedConfigEntries(registry, scope: TreeseedConfigScope) {
	return registry.entries
		.filter((entry) =>
			entry.scopes.includes(scope)
			&& (!entry.isRelevant || entry.isRelevant(registry.context, scope, 'config')),
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
	return {
		id: entry.id,
		label: entry.label,
		group: entry.group,
		description: entry.description,
		howToGet: entry.howToGet,
		sensitivity: entry.sensitivity,
		targets: [...entry.targets],
		purposes: [...entry.purposes],
		storage: entry.storage ?? 'scoped',
		scope,
		sharedScopes: entry.storage === 'shared' ? [...entry.scopes] : [scope],
		required: false,
		currentValue,
		suggestedValue,
		effectiveValue: currentValue || suggestedValue || '',
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
	const authStatusByScope = Object.fromEntries(
		scopes.map((scope) => [scope, createConfigAuthStatus(valuesByScope[scope])]),
	) as TreeseedCollectedConfigContext['authStatusByScope'];
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
		authStatusByScope,
		validationByScope,
		registry,
	};
}

export function applyTreeseedConfigValues({
	tenantRoot,
	updates,
	writeLocalFiles = true,
	applyLocalEnvironment = true,
}: {
	tenantRoot: string;
	updates: TreeseedConfigValueUpdate[];
	writeLocalFiles?: boolean;
	applyLocalEnvironment?: boolean;
}) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
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

	const envFiles = writeLocalFiles ? writeTreeseedLocalEnvironmentFiles(tenantRoot) : null;
	if (applyLocalEnvironment) {
		applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'local', override: true });
	}

	return {
		updated: applied,
		envFiles,
	};
}

export function finalizeTreeseedConfig({
	tenantRoot,
	scopes = [...TREESEED_ENVIRONMENT_SCOPES],
	sync = 'all',
	env = process.env,
	checkConnections = true,
	initializePersistent = true,
}: {
	tenantRoot: string;
	scopes?: TreeseedConfigScope[];
	sync?: 'none' | 'github' | 'cloudflare' | 'railway' | 'all';
	env?: NodeJS.ProcessEnv;
	checkConnections?: boolean;
	initializePersistent?: boolean;
}) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const summary = {
		scopes,
		synced: {} as Record<string, unknown>,
		initialized: [] as Array<{ scope: TreeseedConfigScope; secrets: number; target: string }>,
		connectionChecks: [] as ReturnType<typeof checkTreeseedProviderConnections>[],
		validationByScope: {} as Record<TreeseedConfigScope, ReturnType<typeof validateTreeseedEnvironmentValues>>,
	};

	for (const scope of scopes) {
		const validation = validateTreeseedEnvironmentValues({
			values: resolveTreeseedMachineEnvironmentValues(tenantRoot, scope),
			scope,
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
		});
		summary.validationByScope[scope] = validation;
		if (!validation.ok) {
			const details = [...validation.missing, ...validation.invalid].map((problem) => `- ${problem.message}`).join('\n');
			throw new Error(`Treeseed config validation failed for ${scope}:\n${details}`);
		}

		if (checkConnections) {
			summary.connectionChecks.push(checkTreeseedProviderConnections({ tenantRoot, scope, env }));
		}
	}

	writeTreeseedLocalEnvironmentFiles(tenantRoot);
	syncManagedServiceSettingsFromDeployConfig(tenantRoot);

	if (initializePersistent) {
		for (const scope of scopes) {
			if (scope === 'local') {
				continue;
			}
			applyTreeseedEnvironmentToProcess({ tenantRoot, scope, override: true });
			const initialized = initializeTreeseedPersistentEnvironment({ tenantRoot, scope });
			summary.initialized.push({
				scope,
				secrets: initialized.secrets.length,
				target: initialized.summary.target,
			});
			markManagedServicesInitialized(tenantRoot, { scope });
		}
	}

	if (sync === 'github' || sync === 'all') {
		summary.synced.github = syncTreeseedGitHubEnvironment({ tenantRoot, scope: scopes.at(-1) ?? 'prod' });
	}
	if (sync === 'cloudflare' || sync === 'all') {
		summary.synced.cloudflare = syncTreeseedCloudflareEnvironment({ tenantRoot, scope: scopes.at(-1) ?? 'prod' });
	}
	if (sync === 'railway' || sync === 'all') {
		summary.synced.railway = syncTreeseedRailwayEnvironment({ tenantRoot, scope: scopes.at(-1) ?? 'prod' });
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
