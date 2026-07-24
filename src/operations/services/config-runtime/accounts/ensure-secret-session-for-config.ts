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
import { inspectKeyAgentStatus, unlockSecretSessionFromEnv, unlockSecretSessionInteractive, unlockSecretSessionWithPassphrase } from '../configuration/inspect-key-agent-status.ts';
import { getMachineConfigPaths, keyAgentAutoPromptEnabled, requestKeyAgent, useInlineKeyAgentTransport } from '../hosting/load-tenant-deploy-config.ts';
import { inlineSecretSessions } from '../configuration/machine-config-relative-path.ts';
import { createConfigReadiness } from '../support/summarize-persistent-readiness.ts';
import { collectEnvironmentContext } from '../support/resolve-entry-value-from-buckets.ts';

export async function ensureSecretSessionForConfig({
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
}): Promise<ConfigSecretSessionBootstrap> {
	const status = inspectKeyAgentStatus(tenantRoot);
	if (status.unlocked) {
		return {
			status,
			createdWrappedKey: false,
			migratedWrappedKey: false,
			unlockSource: 'existing-session',
		};
	}

	const wrappedBefore = readWrappedMachineKeyFile(status.keyPath);
	const envPassphrase = String(env[MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
	let unlockSource: 'interactive' | 'env' | 'existing-session' = 'existing-session';
	let nextStatus: KeyAgentStatus;

	if (envPassphrase) {
		nextStatus = unlockSecretSessionWithPassphrase(tenantRoot, envPassphrase, {
			createIfMissing,
			allowMigration,
		});
		unlockSource = 'env';
	} else if (interactive && status.migrationRequired) {
		if (!promptForNewPassphrase) {
			throw new KeyAgentError('interactive_required', 'A passphrase prompt is required to migrate the Treeseed machine key.');
		}
		nextStatus = unlockSecretSessionWithPassphrase(tenantRoot, await promptForNewPassphrase(), {
			createIfMissing: false,
			allowMigration: true,
		});
		unlockSource = 'interactive';
	} else if (interactive && !status.wrappedKeyPresent) {
		if (!promptForNewPassphrase) {
			throw new KeyAgentError('interactive_required', 'A passphrase prompt is required to create the Treeseed machine key.');
		}
		nextStatus = unlockSecretSessionWithPassphrase(tenantRoot, await promptForNewPassphrase(), {
			createIfMissing: true,
			allowMigration: false,
		});
		unlockSource = 'interactive';
	} else if (interactive) {
		if (!promptForPassphrase) {
			throw new KeyAgentError('interactive_required', 'A passphrase prompt is required to unlock the Treeseed machine key.');
		}
		nextStatus = unlockSecretSessionWithPassphrase(tenantRoot, await promptForPassphrase(), {
			createIfMissing: false,
			allowMigration: false,
		});
		unlockSource = 'interactive';
	} else if (status.migrationRequired) {
		throw new KeyAgentError(
			'wrapped_key_migration_required',
			`Set ${MACHINE_KEY_PASSPHRASE_ENV} before running treeseed config non-interactively so Treeseed can wrap the legacy machine key.`,
			{ keyPath: status.keyPath },
		);
	} else if (!status.wrappedKeyPresent) {
		throw new KeyAgentError(
			'wrapped_key_missing',
			`Set ${MACHINE_KEY_PASSPHRASE_ENV} before running treeseed config non-interactively so Treeseed can create the wrapped machine key.`,
			{ keyPath: status.keyPath },
		);
	} else {
		throw new KeyAgentError(
			'locked',
			`Set ${MACHINE_KEY_PASSPHRASE_ENV} before running treeseed config non-interactively so Treeseed can unlock the wrapped machine key.`,
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

export function lockSecretSession(tenantRoot) {
	const { keyPath } = getMachineConfigPaths(tenantRoot);
	if (useInlineKeyAgentTransport()) {
		inlineSecretSessions.set(keyPath, {
			machineKey: null,
			lastTouchedAt: 0,
			idleTimeoutMs: KEY_AGENT_IDLE_TIMEOUT_MS,
		});
		return inspectKeyAgentStatus(tenantRoot);
	}
	const status = inspectKeyAgentStatus(tenantRoot);
	if (!status.running) {
		return status;
	}
	const response = requestKeyAgent(tenantRoot, {
		command: 'lock',
		keyPath: status.keyPath,
		socketPath: status.socketPath,
		idleTimeoutMs: status.idleTimeoutMs,
	});
	assertKeyAgentResponse(response, 'Unable to lock the Treeseed secret session.');
	return response.status;
}

export function resolveUnlockedMachineKey(tenantRoot) {
	const status = inspectKeyAgentStatus(tenantRoot);
	if (!status.unlocked) {
		const envPassphrase = String(process.env[MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
		if (envPassphrase) {
			unlockSecretSessionFromEnv(tenantRoot);
		} else if (keyAgentAutoPromptEnabled()) {
			unlockSecretSessionInteractive(tenantRoot);
		} else if (status.migrationRequired) {
			throw new KeyAgentError(
				'wrapped_key_migration_required',
				'The Treeseed machine key is still stored in the legacy plaintext format. Run `treeseed secrets:migrate-key` or unlock it from an interactive session first.',
				{ keyPath: status.keyPath },
			);
		} else if (!status.wrappedKeyPresent) {
			throw new KeyAgentError(
				'wrapped_key_missing',
				`No wrapped Treeseed machine key exists yet. Run \`treeseed config\` or \`treeseed secrets:unlock\` from an interactive shell, or set ${MACHINE_KEY_PASSPHRASE_ENV} for the startup unlock path.`,
				{ keyPath: status.keyPath },
			);
		} else {
			throw new KeyAgentError(
				'locked',
				`Treeseed secrets are locked. Run \`treeseed secrets:unlock\`, unlock from an interactive session, or set ${MACHINE_KEY_PASSPHRASE_ENV} for the startup unlock path before using secret-backed commands.`,
				{ keyPath: status.keyPath },
			);
		}
	}
	if (useInlineKeyAgentTransport()) {
		const session = inlineSecretSessions.get(status.keyPath);
		if (!session?.machineKey) {
			throw new KeyAgentError('locked', 'Treeseed secrets are locked.');
		}
		session.lastTouchedAt = Date.now();
		return session.machineKey;
	}
	const response = requestKeyAgent(tenantRoot, {
		command: 'get-machine-key',
		keyPath: status.keyPath,
		socketPath: status.socketPath,
		idleTimeoutMs: status.idleTimeoutMs,
	});
	assertKeyAgentResponse(response, 'Unable to resolve the Treeseed machine key from the local key agent.');
	return Buffer.from(String(response.machineKey ?? ''), 'base64');
}

export function getRemoteAuthPaths(tenantRoot) {
	return {
		authPath: getMachineConfigPaths(tenantRoot).authPath,
	};
}

export type ConfigScope = (typeof ENVIRONMENT_SCOPES)[number];

export type ConfigEntrySnapshot = {
	id: string;
	label: string;
	group: string;
	cluster: string;
	startupProfile: 'core' | 'optional' | 'advanced';
	requirement: 'required' | 'conditional' | 'optional' | 'generated';
	description: string;
	howToGet: string;
	sensitivity: 'secret' | 'plain' | 'derived';
	targets: string[];
	purposes: string[];
	storage: 'shared' | 'scoped';
	validation?: EnvironmentValidation;
	sourceRequirement?: string;
	sourceHostType?: string | null;
	sourceProvider?: string | null;
	scope: ConfigScope;
	sharedScopes: ConfigScope[];
	required: boolean;
	currentValue: string;
	suggestedValue: string;
	effectiveValue: string;
};

export type CollectedConfigContext = {
	tenantRoot: string;
	scopes: ConfigScope[];
	project: {
		name: string;
		slug: string;
		siteUrl: string;
	};
	configPath: string;
	keyPath: string;
	entriesByScope: Record<ConfigScope, ConfigEntrySnapshot[]>;
	valuesByScope: Record<ConfigScope, Record<string, string>>;
	suggestedValuesByScope: Record<ConfigScope, Record<string, string>>;
	configReadinessByScope: Record<ConfigScope, ReturnType<typeof createConfigReadiness>>;
	validationByScope: Record<ConfigScope, ReturnType<typeof validateEnvironmentValues>>;
	sharedStorageMigrations: SharedStorageMigrationNotice[];
	registry: ReturnType<typeof collectEnvironmentContext>;
};

export type ConfigSecretSessionBootstrap = {
	status: KeyAgentStatus;
	createdWrappedKey: boolean;
	migratedWrappedKey: boolean;
	unlockSource: 'interactive' | 'env' | 'existing-session';
};

export type ConfigValueUpdate = {
	scope: ConfigScope;
	entryId: string;
	value: string;
	reused?: boolean;
};

export type SharedStorageMigrationNotice = {
	entryId: string;
	label: string;
	promotedFrom: ConfigScope;
	consolidatedScopes: ConfigScope[];
	hadConflicts: boolean;
};
