import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ApiPrincipal, RemoteConfig, RemoteHost } from '../../../../entrypoints/clients/remote.ts';
import {
	getEnvironmentSuggestedValues,
	isEnvironmentEntryRelevant,
	isEnvironmentEntryRequired,
	resolveEnvironmentRegistry,
	ENVIRONMENT_SCOPES,
	type EnvironmentPurpose,
	type EnvironmentValidation,
	validateEnvironmentValues,
} from '../../../../platform/configuration/environment.ts';
import { loadManifest } from '../../../../platform/configuration/tenant-config.ts';
import {
	buildProvisioningSummary,
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
	loadDeployState,
	provisionCloudflareResources,
	syncCloudflareSecrets,
	verifyProvisionedCloudflareResources,
} from '../../hosting/deployment/deploy.ts';
import {
	collectReconcileStatus,
	reconcileTarget,
	resolveBootstrapSelection,
	type BootstrapSystem,
	type DesiredUnit,
	type RunnableBootstrapSystem,
} from '../../../../reconcile/index.ts';
import {
	ensureGitHubBootstrapRepository,
	maybeResolveGitHubRepositorySlug,
} from '../../repositories/github-automation.ts';
import {
	buildRailwayCommandEnv,
	configuredRailwayServices,
	validateRailwayDeployPrerequisites,
} from '../../hosting/railway/railway-deploy.ts';
import {
	ensureRailwayEnvironment,
	ensureRailwayProject,
	ensureRailwayService,
	normalizeRailwayEnvironmentName,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
	upsertRailwayVariables,
} from '../../hosting/railway/railway-api.ts';
import { discoverApplications } from '../../../../hosting/apps.ts';
import {
	createGitHubApiClient,
	ensureGitHubBranchFromBase,
	listGitHubEnvironmentSecretNames,
	listGitHubEnvironmentVariableNames,
} from '../../repositories/github-api.ts';
import { resolveGitHubCredentialForRepository } from '../../configuration/github-credentials.ts';
import { loadCliDeployConfig, packageDistScriptRoot, packageScriptPath, resolveWranglerBin, withProcessCwd } from '../../agents/runtime-tools.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from '../../operations/git-workflow.ts';
import {
	createManagedToolEnv,
	resolveToolBinary,
	resolveToolCommand,
} from '../../../../entrypoints/runtime/managed-dependencies.ts';
import { GITHUB_TOKEN_ENV, resolveGitHubToken, withServiceCredentialEnv } from '../../../../configuration/service-credentials.ts';
import {
	filterManagedHostGitHubEnvironment,
	usesManagedHostOperationRequests,
} from '../../hosting/audit/managed-host-security.ts';
import {
	assertKeyAgentResponse,
	getKeyAgentPaths,
	inspectKeyAgentDiagnostics,
	readWrappedMachineKeyFile,
	replaceWrappedMachineKey,
	rotateWrappedMachineKeyPassphrase,
	KEY_AGENT_IDLE_TIMEOUT_MS,
	MACHINE_KEY_PASSPHRASE_ENV,
	KeyAgentError,
	unwrapMachineKey,
	type KeyAgentStatus,
} from '../../configuration/key-agent.ts';
import { findNearestMachineConfig, getMachineConfigPaths, loadOptionalTenantManifest, loadTenantDeployConfig } from '../hosting/load-tenant-deploy-config.ts';
import { createDefaultMachineConfig, decryptRemoteAuthSessions, encryptRemoteAuthSessions, loadLegacyMachineKey, loadMachineKey, loadRemoteAuthPayload, reencryptEncryptedState, removeLegacyMachineKeyIfSafe, writeRemoteAuthPayload } from '../configuration/create-default-machine-config.ts';
import { getRemoteAuthPaths } from '../accounts/ensure-secret-session-for-config.ts';
import { DEFAULT_API_BASE_URL, API_BASE_URL_ENV, ensureParent, normalizeRemoteSettings, normalizeServiceSettings } from '../configuration/machine-config-relative-path.ts';

export function rotateMachineKeyPassphrase(tenantRoot, passphrase) {
	const { keyPath } = getMachineConfigPaths(tenantRoot);
	const machineKey = loadMachineKey(tenantRoot);
	rotateWrappedMachineKeyPassphrase(keyPath, machineKey, passphrase);
	return {
		keyPath,
		rotated: true,
	};
}

export function migrateMachineKeyToWrapped(tenantRoot, passphrase) {
	const { keyPath } = getMachineConfigPaths(tenantRoot);
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
			throw new KeyAgentError(
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

export function loadRemoteAuthState(tenantRoot) {
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
		reencryptEncryptedState(tenantRoot, legacyKey, key);
		removeLegacyMachineKeyIfSafe(tenantRoot);
	}
	return {
		version: 1,
		sessions,
	};
}

export function writeRemoteAuthState(tenantRoot, state) {
	const key = loadMachineKey(tenantRoot);
	writeRemoteAuthPayload(tenantRoot, {
		version: 1,
		sessions: encryptRemoteAuthSessions(state.sessions, key),
	});
}

export function setRemoteSession(tenantRoot, { hostId, accessToken, refreshToken, expiresAt, principal }) {
	const state = loadRemoteAuthState(tenantRoot);
	state.sessions[hostId] = {
		accessToken,
		refreshToken,
		expiresAt,
		principal: principal ?? null,
	};
	writeRemoteAuthState(tenantRoot, state);
	return state.sessions[hostId];
}

export function clearRemoteSession(tenantRoot, hostId) {
	const state = loadRemoteAuthState(tenantRoot);
	if (hostId) {
		delete state.sessions[hostId];
	} else {
		state.sessions = {};
	}
	writeRemoteAuthState(tenantRoot, state);
	return state;
}

export function resolveRemoteSession(tenantRoot, hostId) {
	const { authPath } = getRemoteAuthPaths(tenantRoot);
	if (!existsSync(authPath)) {
		return null;
	}
	const sessionState = loadRemoteAuthState(tenantRoot);
	const { configPath } = getMachineConfigPaths(tenantRoot);
	const selectedHostId = hostId ?? (existsSync(configPath) ? loadMachineConfig(tenantRoot).settings?.remote?.activeHostId : 'official') ?? 'official';
	return sessionState.sessions?.[selectedHostId] ?? null;
}

export function loadMachineConfig(tenantRoot) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const tenantConfig = loadOptionalTenantManifest(tenantRoot);
	const defaults = createDefaultMachineConfig({ tenantRoot, deployConfig, tenantConfig });
	const { configPath } = getMachineConfigPaths(tenantRoot);

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
			ENVIRONMENT_SCOPES.map((scope) => [
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

export function writeMachineConfig(tenantRoot, config) {
	const { configPath } = getMachineConfigPaths(tenantRoot);
	ensureParent(configPath);
	writeFileSync(configPath, stringifyYaml(config), 'utf8');
}

export function updateDeployConfigFeatureToggles(
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

export function resolveRemoteConfig(startRoot = process.cwd(), env = process.env): RemoteConfig {
	const machineConfigPath = findNearestMachineConfig(startRoot);
	const tenantRoot = machineConfigPath ? resolve(dirname(dirname(machineConfigPath)), '..') : startRoot;
	const deployConfig = existsSync(resolve(tenantRoot, 'treeseed.site.yaml')) ? loadTenantDeployConfig(tenantRoot) : null;
	const machineConfig = machineConfigPath ? loadMachineConfig(tenantRoot) : createDefaultMachineConfig({
		tenantRoot: startRoot,
		deployConfig: {
			name: 'TreeSeed',
			slug: 'treeseed',
			siteUrl: DEFAULT_API_BASE_URL,
			contactEmail: 'hello@treeseed.ai',
		},
		tenantConfig: undefined,
	});
	const settings = normalizeRemoteSettings(machineConfig.settings?.remote);
	const deployBaseUrl = env[API_BASE_URL_ENV]
		?? deployConfig?.services?.api?.environments?.prod?.baseUrl
		?? deployConfig?.services?.api?.publicBaseUrl
		?? null;
	if (deployBaseUrl) {
		const officialHost = settings.hosts.find((entry) => entry.id === 'official');
		if (officialHost) {
			officialHost.baseUrl = deployBaseUrl.replace(/\/$/u, '');
		}
	}
	const envBaseUrl = env[API_BASE_URL_ENV];
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
	const auth = resolveRemoteSession(tenantRoot, activeHostId);

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
