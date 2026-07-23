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
import { DEFAULT_TEMPLATE_CATALOG_URL, TEMPLATE_CATALOG_CACHE_RELATIVE_PATH, TREESEED_TEMPLATE_CATALOG_URL_ENV, warnDeprecatedTreeseedLocalEnvFiles } from './machine-config-relative-path.ts';
import { findNearestTreeseedMachineConfig, getTreeseedMachineConfigPaths, loadTenantDeployConfig } from './load-tenant-deploy-config.ts';
import { createDefaultTreeseedMachineConfig, decryptValueWithMachineKey, encryptValue } from './create-default-treeseed-machine-config.ts';
import { loadTreeseedMachineConfig, writeTreeseedMachineConfig } from './rotate-treeseed-machine-key-passphrase.ts';
import { inspectTreeseedKeyAgentStatus } from './inspect-treeseed-key-agent-status.ts';
import { TreeseedSharedStorageMigrationNotice } from './ensure-treeseed-secret-session-for-config.ts';

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

	return resolve(startRoot, '.treeseed', 'cache', TEMPLATE_CATALOG_CACHE_RELATIVE_PATH);
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

export function ensureTreeseedRailwayIgnoreEntries(tenantRoot) {
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

export type TreeseedRepairAction = {
	id: string;
	detail: string;
};

export function dedupeRepairActions(actions: TreeseedRepairAction[]) {
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
	ensureTreeseedRailwayIgnoreEntries(tenantRoot);
	actions.push({ id: 'railwayignore', detail: 'Ensured Railway deploy ignore entries are present.' });
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
