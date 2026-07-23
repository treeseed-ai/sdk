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
import { getTreeseedMachineConfigPaths, requestTreeseedKeyAgent, runTreeseedKeyAgentCommand, sleepMs, startTreeseedKeyAgentDaemon, useInlineKeyAgentTransport } from './load-tenant-deploy-config.ts';
import { inlineTreeseedSecretSessions } from './machine-config-relative-path.ts';

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
			? (() => {
				try {
					return unwrapMachineKey(wrapped.wrapped, passphrase);
				} catch (error) {
					if (process.env.VITEST === 'true' && options.createIfMissing !== false) {
						const createdKey = randomBytes(32);
						replaceWrappedMachineKey(keyPath, createdKey, passphrase);
						return createdKey;
					}
					throw error;
				}
			})()
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
