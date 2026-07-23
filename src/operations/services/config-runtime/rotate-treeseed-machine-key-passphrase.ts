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
import { findNearestTreeseedMachineConfig, getTreeseedMachineConfigPaths, loadOptionalTenantManifest, loadTenantDeployConfig } from './load-tenant-deploy-config.ts';
import { createDefaultTreeseedMachineConfig, decryptRemoteAuthSessions, encryptRemoteAuthSessions, loadLegacyMachineKey, loadMachineKey, loadRemoteAuthPayload, reencryptTreeseedEncryptedState, removeLegacyMachineKeyIfSafe, writeRemoteAuthPayload } from './create-default-treeseed-machine-config.ts';
import { getTreeseedRemoteAuthPaths } from './ensure-treeseed-secret-session-for-config.ts';
import { DEFAULT_TREESEED_API_BASE_URL, TREESEED_API_BASE_URL_ENV, ensureParent, normalizeRemoteSettings, normalizeServiceSettings } from './machine-config-relative-path.ts';

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
