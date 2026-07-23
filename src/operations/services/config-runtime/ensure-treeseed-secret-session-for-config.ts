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
import { inspectTreeseedKeyAgentStatus, unlockTreeseedSecretSessionFromEnv, unlockTreeseedSecretSessionInteractive, unlockTreeseedSecretSessionWithPassphrase } from './inspect-treeseed-key-agent-status.ts';
import { getTreeseedMachineConfigPaths, keyAgentAutoPromptEnabled, requestTreeseedKeyAgent, useInlineKeyAgentTransport } from './load-tenant-deploy-config.ts';
import { inlineTreeseedSecretSessions } from './machine-config-relative-path.ts';
import { createConfigReadiness } from './summarize-persistent-readiness.ts';
import { collectTreeseedEnvironmentContext } from './resolve-entry-value-from-buckets.ts';

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

export function resolveUnlockedMachineKey(tenantRoot) {
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
	requirement: 'required' | 'conditional' | 'optional' | 'generated';
	description: string;
	howToGet: string;
	sensitivity: 'secret' | 'plain' | 'derived';
	targets: string[];
	purposes: string[];
	storage: 'shared' | 'scoped';
	validation?: TreeseedEnvironmentValidation;
	sourceRequirement?: string;
	sourceHostType?: string | null;
	sourceProvider?: string | null;
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
