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
import { DEFAULT_TEMPLATE_CATALOG_URL, TENANT_ENVIRONMENT_OVERLAY_PATH, createDefaultRemoteSettings, createDefaultServiceSettings, ensureParent } from './machine-config-relative-path.ts';
import { getTreeseedMachineConfigPaths } from './load-tenant-deploy-config.ts';
import { getTreeseedRemoteAuthPaths, resolveUnlockedMachineKey } from './ensure-treeseed-secret-session-for-config.ts';
import { loadTreeseedMachineConfig, writeTreeseedMachineConfig } from './rotate-treeseed-machine-key-passphrase.ts';
import { inspectTreeseedKeyAgentStatus, unlockTreeseedSecretSessionFromEnv } from './inspect-treeseed-key-agent-status.ts';

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

export function loadLegacyMachineKey(tenantRoot) {
	const { legacyKeyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	if (!existsSync(legacyKeyPath)) {
		return null;
	}
	try {
		const raw = readFileSync(legacyKeyPath, 'utf8').trim();
		if (!raw || raw.startsWith('{')) {
			return null;
		}
		const key = Buffer.from(raw, 'base64');
		return key.length === 32 ? key : null;
	} catch {
		return null;
	}
}

export function createDefaultRemoteAuthState() {
	return {
		version: 1,
		sessions: {},
	};
}

export function encryptValue(value, key) {
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

export function decryptValue(payload, key) {
	if (!payload || typeof payload !== 'object') {
		return '';
	}
	if (!Buffer.isBuffer(key) || key.length !== 32) {
		throw new TreeseedKeyAgentError(
			'invalid_machine_key',
			'The Treeseed machine key is invalid or corrupt.',
		);
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

export function decryptMachineConfigSecrets(config, key) {
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

export function applyMachineConfigSecrets(config, secrets, key) {
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

export function decryptRemoteAuthSessions(payload, key) {
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

export function encryptRemoteAuthSessions(sessions, key) {
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

export function loadRemoteAuthPayload(tenantRoot) {
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

export function writeRemoteAuthPayload(tenantRoot, payload) {
	const { authPath } = getTreeseedRemoteAuthPaths(tenantRoot);
	ensureParent(authPath);
	writeFileSync(authPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function removeLegacyMachineKeyIfSafe(tenantRoot) {
	const { legacyKeyPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	if (legacyKeyPath !== keyPath && existsSync(legacyKeyPath)) {
		rmSync(legacyKeyPath, { force: true });
	}
}

export function reencryptTreeseedEncryptedState(tenantRoot, oldKey, newKey) {
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

export function loadMachineKey(tenantRoot) {
	return resolveUnlockedMachineKey(tenantRoot);
}

export function decryptValueWithMachineKey(tenantRoot, payload, key) {
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
