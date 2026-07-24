import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ApiPrincipal, RemoteConfig, RemoteHost } from '../../../../../entrypoints/clients/remote.ts';
import {
	getEnvironmentSuggestedValues,
	isEnvironmentEntryRelevant,
	isEnvironmentEntryRequired,
	resolveEnvironmentRegistry,
	ENVIRONMENT_SCOPES,
	type EnvironmentPurpose,
	type EnvironmentValidation,
	validateEnvironmentValues,
} from '../../../../../platform/configuration/environment.ts';
import { loadManifest } from '../../../../../platform/configuration/tenant-config.ts';
import {
	buildProvisioningSummary,
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
	loadDeployState,
	provisionCloudflareResources,
	syncCloudflareSecrets,
	verifyProvisionedCloudflareResources,
} from '../../../hosting/deployment/deploy.ts';
import {
	collectReconcileStatus,
	reconcileTarget,
	resolveBootstrapSelection,
	type BootstrapSystem,
	type DesiredUnit,
	type RunnableBootstrapSystem,
} from '../../../../../reconcile/index.ts';
import {
	ensureGitHubBootstrapRepository,
	maybeResolveGitHubRepositorySlug,
} from '../../../repositories/github-automation.ts';
import {
	buildRailwayCommandEnv,
	configuredRailwayServices,
	validateRailwayDeployPrerequisites,
} from '../../../hosting/railway/railway-deploy.ts';
import {
	ensureRailwayEnvironment,
	ensureRailwayProject,
	ensureRailwayService,
	normalizeRailwayEnvironmentName,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
	upsertRailwayVariables,
} from '../../../hosting/railway/railway-api.ts';
import { discoverApplications } from '../../../../../hosting/apps.ts';
import {
	createGitHubApiClient,
	ensureGitHubBranchFromBase,
	listGitHubEnvironmentSecretNames,
	listGitHubEnvironmentVariableNames,
} from '../../../repositories/github-api.ts';
import { resolveGitHubCredentialForRepository } from '../../../configuration/github-credentials.ts';
import { loadCliDeployConfig, packageDistScriptRoot, packageScriptPath, resolveWranglerBin, withProcessCwd } from '../../../agents/runtime-tools.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from '../../../operations/git-workflow.ts';
import {
	createManagedToolEnv,
	resolveToolBinary,
	resolveToolCommand,
} from '../../../../../entrypoints/runtime/managed-dependencies.ts';
import { GITHUB_TOKEN_ENV, resolveGitHubToken, withServiceCredentialEnv } from '../../../../../configuration/service-credentials.ts';
import {
	filterManagedHostGitHubEnvironment,
	usesManagedHostOperationRequests,
} from '../../../hosting/audit/managed-host-security.ts';
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
} from '../../../configuration/key-agent.ts';
import { DEFAULT_TEMPLATE_CATALOG_URL, TEMPLATE_CATALOG_CACHE_RELATIVE_PATH, TEMPLATE_CATALOG_URL_ENV, warnDeprecatedLocalEnvFiles } from '../../configuration/machine-config-relative-path.ts';
import { findNearestMachineConfig, getMachineConfigPaths, loadTenantDeployConfig } from '../../hosting/load-tenant-deploy-config.ts';
import { createDefaultMachineConfig, decryptValueWithMachineKey, encryptValue } from '../../configuration/create-default-machine-config.ts';
import { loadMachineConfig, writeMachineConfig } from '../../support/rotate-machine-key-passphrase.ts';
import { inspectKeyAgentStatus } from '../../configuration/inspect-key-agent-status.ts';
import { SharedStorageMigrationNotice } from '../../accounts/ensure-secret-session-for-config.ts';

export function resolveTemplateCatalogEndpoint(startRoot = process.cwd(), env = process.env) {
	const envValue = env[TEMPLATE_CATALOG_URL_ENV];
	if (typeof envValue === 'string' && envValue.trim().length > 0) {
		return envValue.trim();
	}

	const machineConfigPath = findNearestMachineConfig(startRoot);
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

export function resolveTemplateCatalogCachePath(startRoot = process.cwd()) {
	const machineConfigPath = findNearestMachineConfig(startRoot);
	if (machineConfigPath) {
		return resolve(dirname(dirname(machineConfigPath)), 'cache', 'template-catalog.json');
	}

	return resolve(startRoot, '.treeseed', 'cache', TEMPLATE_CATALOG_CACHE_RELATIVE_PATH);
}

export function ensureGitignoreEntries(tenantRoot) {
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

export function ensureRailwayIgnoreEntries(tenantRoot) {
	const railwayIgnorePath = resolve(tenantRoot, '.railwayignore');
	const requiredEntries = [
		'.astro/',
		'.codex/',
		'.dev.vars',
		'.env.local',
		'.git/',
		'.treeseed/',
		'.wrangler/',
		'coverage/',
		'node_modules/',
		'npm-debug.log*',
		'packages/*/.git/',
		'packages/*/node_modules/',
		'public/__treeseed/*.json',
		'public/books/*.json',
		'public/books/*.md',
		'scripts/.ts-run-*.mjs',
		'tmp/',
		'*.log',
		'*.tgz',
	];
	const removedEntries = new Set([
		'dist/',
		'**/dist/',
		'packages/*/dist/',
	]);
	const current = existsSync(railwayIgnorePath) ? readFileSync(railwayIgnorePath, 'utf8') : '';
	let changed = false;
	const lines = current
		.split(/\r?\n/)
		.filter((line) => {
			const keep = !removedEntries.has(line.trim());
			if (!keep) {
				changed = true;
			}
			return keep;
		});

	for (const entry of requiredEntries) {
		if (!lines.includes(entry)) {
			lines.push(entry);
			changed = true;
		}
	}

	if (changed || !existsSync(railwayIgnorePath)) {
		writeFileSync(railwayIgnorePath, `${lines.filter(Boolean).join('\n')}\n`, 'utf8');
	}

	return railwayIgnorePath;
}

export type RepairAction = {
	id: string;
	detail: string;
};

export function dedupeRepairActions(actions: RepairAction[]) {
	const seen = new Set<string>();
	return actions.filter((action) => {
		if (seen.has(action.id)) {
			return false;
		}
		seen.add(action.id);
		return true;
	});
}

export function applySafeRepairs(tenantRoot: string): RepairAction[] {
	const actions: RepairAction[] = [];
	ensureGitignoreEntries(tenantRoot);
	actions.push({ id: 'gitignore', detail: 'Ensured Treeseed gitignore entries are present.' });
	ensureRailwayIgnoreEntries(tenantRoot);
	actions.push({ id: 'railwayignore', detail: 'Ensured Railway deploy ignore entries are present.' });
	const deprecatedFiles = warnDeprecatedLocalEnvFiles(tenantRoot);
	if (deprecatedFiles.length > 0) {
		actions.push({ id: 'deprecated-local-env', detail: 'Detected deprecated .env.local/.dev.vars files that Treeseed now ignores.' });
	}

	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const { configPath } = getMachineConfigPaths(tenantRoot);
	if (!existsSync(configPath)) {
		const machineConfig = createDefaultMachineConfig({
			tenantRoot,
			deployConfig,
			tenantConfig: undefined,
		});
		writeMachineConfig(tenantRoot, machineConfig);
		actions.push({ id: 'machine-config', detail: 'Created the default Treeseed machine config.' });
	}

	const keyStatus = inspectKeyAgentStatus(tenantRoot);
	if (!keyStatus.wrappedKeyPresent && !keyStatus.migrationRequired) {
		actions.push({ id: 'machine-key', detail: 'Treeseed will create a wrapped machine key the first time the secret session is unlocked.' });
	} else if (keyStatus.migrationRequired) {
		actions.push({ id: 'machine-key-migration', detail: 'Detected a legacy plaintext machine key that must be wrapped on the next unlock.' });
	}

	const machineConfig = loadMachineConfig(tenantRoot);
	writeMachineConfig(tenantRoot, machineConfig);

	for (const scope of ENVIRONMENT_SCOPES) {
		const target = createPersistentDeployTarget(scope);
		const state = loadDeployState(tenantRoot, deployConfig, { target });
		if (state.readiness?.initialized || scope === 'local') {
			ensureGeneratedWranglerConfig(tenantRoot, { target });
			actions.push({ id: `wrangler-${scope}`, detail: `Regenerated the ${scope} generated Wrangler config.` });
		}
	}

	return dedupeRepairActions(actions);
}

export function decryptMachineEnvironmentBucket(tenantRoot, config, key, bucket) {
	const values = {
		...(bucket?.values ?? {}),
	};

	for (const [entryId, payload] of Object.entries(bucket?.secrets ?? {})) {
		if (!key) {
			continue;
		}
		values[entryId] = decryptValueWithMachineKey(tenantRoot, payload, key);
	}

	return values;
}

export function readMachineBucketEntryValue(tenantRoot, key, bucket, entry) {
	if (entry.sensitivity === 'secret') {
		const payload = bucket?.secrets?.[entry.id];
		return typeof payload === 'string' && payload.length > 0
			? decryptValueWithMachineKey(tenantRoot, payload, key)
			: '';
	}
	return typeof bucket?.values?.[entry.id] === 'string' ? bucket.values[entry.id] : '';
}

export function writeMachineBucketEntryValue(target, entry, value, key) {
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

export function migrateLegacyScopedSharedEntries(tenantRoot, config, registryEntries, key) {
	const notices: SharedStorageMigrationNotice[] = [];
	let changed = false;

	for (const entry of registryEntries) {
		if (entry.storage !== 'shared') {
			continue;
		}

		const sharedValue = readMachineBucketEntryValue(tenantRoot, key, config.shared, entry);
		if (sharedValue.length > 0) {
			continue;
		}

		const scopedValues = ENVIRONMENT_SCOPES
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
		for (const candidateScope of ENVIRONMENT_SCOPES) {
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
		writeMachineConfig(tenantRoot, config);
	}

	return notices;
}
