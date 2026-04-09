import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ApiPrincipal, RemoteTreeseedConfig, RemoteTreeseedHost } from '../../remote.ts';
import {
	getTreeseedEnvironmentSuggestedValues,
	resolveTreeseedEnvironmentRegistry,
	TREESEED_ENVIRONMENT_SCOPES,
	validateTreeseedEnvironmentValues,
} from '@treeseed/core/environment';
import { loadTreeseedManifest } from '@treeseed/core/tenant-config';
import {
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
	markManagedServicesInitialized,
	markDeploymentInitialized,
	provisionCloudflareResources,
	syncCloudflareSecrets,
} from './deploy-lib.ts';
import { maybeResolveGitHubRepositorySlug } from './github-automation-lib.ts';
import { loadCliDeployConfig, withProcessCwd } from './package-tools.ts';

const MACHINE_CONFIG_RELATIVE_PATH = '.treeseed/config/machine.yaml';
const MACHINE_KEY_RELATIVE_PATH = '.treeseed/config/machine.key';
const REMOTE_AUTH_RELATIVE_PATH = '.treeseed/config/remote-auth.json';
const TEMPLATE_CATALOG_CACHE_RELATIVE_PATH = 'treeseed/cache/template-catalog.json';
const TENANT_ENVIRONMENT_OVERLAY_PATH = 'src/env.yaml';
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
	return {
		configPath: resolve(tenantRoot, MACHINE_CONFIG_RELATIVE_PATH),
		keyPath: resolve(tenantRoot, MACHINE_KEY_RELATIVE_PATH),
	};
}

export function getTreeseedRemoteAuthPaths(tenantRoot) {
	return {
		authPath: resolve(tenantRoot, REMOTE_AUTH_RELATIVE_PATH),
	};
}

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

function loadMachineKey(tenantRoot) {
	const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	if (existsSync(keyPath)) {
		return Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
	}

	const key = randomBytes(32);
	ensureParent(keyPath);
	writeFileSync(keyPath, `${key.toString('base64')}\n`, { mode: 0o600 });
	return key;
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

export function loadTreeseedRemoteAuthState(tenantRoot) {
	const key = loadMachineKey(tenantRoot);
	const payload = loadRemoteAuthPayload(tenantRoot);
	const sessions = Object.fromEntries(
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
	return {
		version: 1,
		sessions,
	};
}

export function writeTreeseedRemoteAuthState(tenantRoot, state) {
	const key = loadMachineKey(tenantRoot);
	const sessions = Object.fromEntries(
		Object.entries(state.sessions ?? {}).map(([hostId, entry]) => [
			hostId,
			{
				accessToken: entry.accessToken ? encryptValue(entry.accessToken, key) : null,
				refreshToken: entry.refreshToken ? encryptValue(entry.refreshToken, key) : null,
				expiresAt: entry.expiresAt ?? '',
				principal: entry.principal ?? null,
			},
		]),
	);
	writeRemoteAuthPayload(tenantRoot, {
		version: 1,
		sessions,
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

export function resolveTreeseedMachineEnvironmentValues(tenantRoot, scope) {
	const key = loadMachineKey(tenantRoot);
	const config = loadTreeseedMachineConfig(tenantRoot);
	const values = {
		...(config.environments?.[scope]?.values ?? {}),
	};

	for (const [entryId, payload] of Object.entries(config.environments?.[scope]?.secrets ?? {})) {
		values[entryId] = decryptValue(payload, key);
	}

	return values;
}

export function setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, value) {
	const key = loadMachineKey(tenantRoot);
	const config = loadTreeseedMachineConfig(tenantRoot);
	const scoped = config.environments[scope];

	if (entry.sensitivity === 'secret') {
		delete scoped.values[entry.id];
		if (value) {
			scoped.secrets[entry.id] = encryptValue(value, key);
		} else {
			delete scoped.secrets[entry.id];
		}
	} else {
		delete scoped.secrets[entry.id];
		if (value) {
			scoped.values[entry.id] = value;
		} else {
			delete scoped.values[entry.id];
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

export function collectTreeseedConfigSeedValues(tenantRoot, scope) {
	return {
		...readEnvFileIfPresent(resolve(tenantRoot, '.env.local')),
		...readEnvFileIfPresent(resolve(tenantRoot, '.dev.vars')),
		...resolveTreeseedMachineEnvironmentValues(tenantRoot, scope),
	};
}

export function applyTreeseedEnvironmentToProcess({ tenantRoot, scope }) {
	const resolvedValues = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	for (const [key, value] of Object.entries(resolvedValues)) {
		if ((process.env[key] ?? '').length === 0 && typeof value === 'string' && value.length > 0) {
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

	const envEntries = registry.entries.filter(
		(entry) =>
			entry.scopes.includes(scope)
			&& entry.targets.includes('local-file'),
	);
	const devVarsEntries = registry.entries.filter(
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
	const services = ['api', 'agents']
		.map((serviceKey) => {
			const service = deployConfig.services?.[serviceKey];
			if (!service || service.enabled === false || (service.provider ?? 'railway') !== 'railway') {
				return null;
			}
			const environment = service.environments?.[scope];
			return {
				service: serviceKey,
				projectName: service.railway?.projectName ?? config.settings.services.railway.projectName,
				serviceName: service.railway?.serviceName ?? config.settings.services.railway[serviceKey === 'api' ? 'apiServiceName' : 'agentsServiceName'],
				baseUrl: environment?.baseUrl ?? service.publicBaseUrl ?? '(unset)',
				dryRun,
			};
		})
		.filter(Boolean);

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

export async function runTreeseedConfigWizard({
	tenantRoot,
	scopes = ['local', 'staging', 'prod'],
	sync = 'none',
	prompt,
	authStatus,
	write = console.log,
}) {
	ensureTreeseedGitignoreEntries(tenantRoot);
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const groups = ['local-development', 'forms', 'smtp', 'cloudflare'];
	const summary = {
		scopes,
		updated: [],
		synced: {},
		initialized: [],
	};

	for (const scope of scopes) {
		const existingValues = collectTreeseedConfigSeedValues(tenantRoot, scope);
		const suggested = getTreeseedEnvironmentSuggestedValues({
			scope,
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
		});

		write(`\nTreeseed configuration for ${scope}`);
		write(`Tenant: ${registry.context.deployConfig.name} (${registry.context.deployConfig.slug})`);
		if (authStatus) {
			write(`GitHub auth: ${authStatus.gh?.authenticated ? 'ready' : 'not ready'}`);
			write(`Wrangler auth: ${authStatus.wrangler?.authenticated ? 'ready' : 'not ready'}`);
		}

		for (const group of groups) {
			const groupEntries = registry.entries.filter(
				(entry) =>
					entry.group === group
					&& entry.scopes.includes(scope)
					&& (!entry.isRelevant || entry.isRelevant(registry.context, scope, 'config')),
			);
			if (groupEntries.length === 0) {
				continue;
			}

			write(`\n[${group}]`);
			for (const entry of groupEntries) {
				const currentValue = existingValues[entry.id];
				const suggestedValue = suggested[entry.id];
				const displayValue = currentValue ?? suggestedValue ?? '';
				write(`\n${entry.label} (${entry.id})`);
				write(`Why: ${entry.description}`);
				write(`How to get it: ${entry.howToGet}`);
				write(`Used for: ${entry.purposes.join(', ')}`);
				write(`Targets: ${entry.targets.join(', ')}`);
				write(`Current: ${entry.sensitivity === 'secret' ? maskValue(currentValue) : currentValue ?? '(unset)'}`);

				const answer = (await prompt(
					`${entry.id}${displayValue ? ` [${entry.sensitivity === 'secret' ? 'keep current' : displayValue}]` : ''}: `,
				)).trim();

				if (answer === '' && displayValue) {
					setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, displayValue);
					summary.updated.push({ scope, id: entry.id, reused: true });
					continue;
				}

				if (answer === '' && !displayValue) {
					setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, '');
					continue;
				}

				if (answer === '-') {
					setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, '');
					summary.updated.push({ scope, id: entry.id, cleared: true });
					continue;
				}

				setTreeseedMachineEnvironmentValue(tenantRoot, scope, entry, answer);
				summary.updated.push({ scope, id: entry.id, reused: false });
			}
		}

		const validation = validateTreeseedEnvironmentValues({
			values: resolveTreeseedMachineEnvironmentValues(tenantRoot, scope),
			scope,
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
		});
		if (!validation.ok) {
			const details = [...validation.missing, ...validation.invalid]
				.map((problem) => `- ${problem.message}`)
				join('\n');
			throw new Error(`Treeseed config validation failed for ${scope}:\n${details}`);
		}
	}

	writeTreeseedLocalEnvironmentFiles(tenantRoot);
	syncManagedServiceSettingsFromDeployConfig(tenantRoot);

	for (const scope of scopes) {
		if (scope === 'local') {
			continue;
		}

		const initialized = initializeTreeseedPersistentEnvironment({ tenantRoot, scope });
		if (write) {
			writeDeploySummary(write, initialized.summary);
		}
		summary.initialized.push({
			scope,
			secrets: initialized.secrets.length,
			target: initialized.summary.target,
		});
		markManagedServicesInitialized(tenantRoot, { scope });
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
