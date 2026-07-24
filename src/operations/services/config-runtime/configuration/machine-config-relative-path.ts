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
import { providerConnectionResult } from '../agents/ensure-act-verification-tooling.ts';
import { ConfigScope } from '../accounts/ensure-secret-session-for-config.ts';
import { loadMachineConfig, writeMachineConfig } from '../support/rotate-machine-key-passphrase.ts';
import { loadTenantDeployConfig } from '../hosting/load-tenant-deploy-config.ts';

export { MACHINE_KEY_PASSPHRASE_ENV, KeyAgentError } from '../../configuration/key-agent.ts';

export const MACHINE_CONFIG_RELATIVE_PATH = '.treeseed/config/machine.yaml';

export const MACHINE_KEY_HOME_RELATIVE_PATH = '.treeseed/config/machine.key';

export const LEGACY_MACHINE_KEY_RELATIVE_PATH = '.treeseed/config/machine.key';

export const REMOTE_AUTH_RELATIVE_PATH = '.treeseed/config/remote-auth.json';

export const WORKTREE_METADATA_RELATIVE_PATH = '.treeseed/worktree.json';

export const TEMPLATE_CATALOG_CACHE_RELATIVE_PATH = 'treeseed/cache/template-catalog.json';

export const TENANT_ENVIRONMENT_OVERLAY_PATH = 'src/env.yaml';

export const CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER = 'replace-with-cloudflare-account-id';

export const KEY_AGENT_AUTOPROMPT_ENV = 'TREESEED_KEY_AGENT_AUTOPROMPT';

export const KEY_AGENT_COMMAND_TIMEOUT_MS = 10_000;

export const DEFAULT_API_BASE_URL = 'https://api.treeseed.dev';

export const DEFAULT_TEMPLATE_CATALOG_URL = 'https://api.treeseed.dev/search/templates';

export const TEMPLATE_CATALOG_URL_ENV = 'TREESEED_TEMPLATE_CATALOG_URL';

export const API_BASE_URL_ENV = 'TREESEED_API_BASE_URL';

export const CLI_CHECK_TIMEOUT_MS = 5000;

export const DEPRECATED_LOCAL_ENV_FILES = ['.env.local', '.dev.vars'] as const;

export const PROVIDER_CONTROL_ENV_KEYS = [
	'TREESEED_GITHUB_TOKEN',
	'TREESEED_CLOUDFLARE_API_TOKEN',
	'TREESEED_CLOUDFLARE_ACCOUNT_ID',
	'CLOUDFLARE_ZONE_ID',
	'TREESEED_RAILWAY_API_TOKEN',
	'TREESEED_RAILWAY_WORKSPACE',
];

export const warnedDeprecatedLocalEnvRoots = new Set<string>();

export const inlineSecretSessions = new Map<string, { machineKey: Buffer | null; lastTouchedAt: number; idleTimeoutMs: number }>();

export const machineKeyHomeRootsByConfigRoot = new Map<string, string>();

export const railwayConnectionCheckCache = new Map<string, Promise<ReturnType<typeof providerConnectionResult>>>();

export function filterEnvironmentValuesByRegistry(
	values,
	registry,
	scope: ConfigScope,
	purpose: EnvironmentPurpose = 'config',
) {
	const registeredKeys = new Set(registry.entries
		.filter((entry) => isEnvironmentEntryRelevant(entry, registry.context, scope, purpose))
		.map((entry) => entry.id));
	return Object.fromEntries(
		Object.entries(values).filter(([key]) => registeredKeys.has(key)),
	);
}

export function inspectPassphraseEnvDiagnostic(env: NodeJS.ProcessEnv = process.env) {
	const configured = typeof env[MACHINE_KEY_PASSPHRASE_ENV] === 'string'
		&& env[MACHINE_KEY_PASSPHRASE_ENV]!.trim().length > 0;
	return {
		envVar: MACHINE_KEY_PASSPHRASE_ENV,
		configured,
		recommendedLaunch: `Export ${MACHINE_KEY_PASSPHRASE_ENV} in a shell and launch \`code .\` from that shell before starting the Codex session.`,
	};
}

export async function inspectKeyAgentTransportDiagnostic() {
	const { socketPath, pidPath } = getKeyAgentPaths();
	const diagnostics = await inspectKeyAgentDiagnostics(socketPath);
	return {
		socketPath,
		pidPath,
		...diagnostics,
	};
}

export function createDefaultRemoteHost() {
	return {
		id: 'official',
		label: 'TreeSeed Official API',
		baseUrl: DEFAULT_API_BASE_URL,
		official: true,
	};
}

export function createDefaultRemoteSettings() {
	return {
		activeHostId: 'official',
		executionMode: 'prefer-local',
		hosts: [createDefaultRemoteHost()],
	};
}

export function normalizeRemoteSettings(value) {
	const record = value && typeof value === 'object' ? value : {};
	const hosts = Array.isArray(record.hosts)
		? record.hosts
			.filter((entry) => entry && typeof entry === 'object')
			.map((entry) => ({
				id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : 'official',
				label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : undefined,
				baseUrl: typeof entry.baseUrl === 'string' && entry.baseUrl.trim() ? entry.baseUrl.trim().replace(/\/$/u, '') : DEFAULT_API_BASE_URL,
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

export function createDefaultServiceSettings() {
	return {
		railway: {
			projectId: '',
			projectName: '',
			apiServiceId: '',
			apiServiceName: '',
		},
	};
}

export function normalizeServiceSettings(value) {
	const record = value && typeof value === 'object' ? value : {};
	const railway = record.railway && typeof record.railway === 'object' ? record.railway : {};
	return {
		railway: {
			projectId: typeof railway.projectId === 'string' ? railway.projectId : '',
			projectName: typeof railway.projectName === 'string' ? railway.projectName : '',
			apiServiceId: typeof railway.apiServiceId === 'string' ? railway.apiServiceId : '',
			apiServiceName: typeof railway.apiServiceName === 'string' ? railway.apiServiceName : '',
		},
	};
}

export function ensureParent(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

export function listDeprecatedLocalEnvFiles(tenantRoot) {
	return DEPRECATED_LOCAL_ENV_FILES
		.map((fileName) => resolve(tenantRoot, fileName))
		.filter((filePath) => existsSync(filePath));
}

export function warnDeprecatedLocalEnvFiles(tenantRoot, write = (line: string) => console.warn(line)) {
	const existing = listDeprecatedLocalEnvFiles(tenantRoot);
	if (existing.length === 0 || warnedDeprecatedLocalEnvRoots.has(tenantRoot)) {
		return existing;
	}

	warnedDeprecatedLocalEnvRoots.add(tenantRoot);
	write(
		`Treeseed ignores deprecated local env files: ${existing.map((filePath) => filePath.replace(`${tenantRoot}/`, '')).join(', ')}. Delete them and rely on .treeseed/config/machine.yaml plus Treeseed-launched commands.`,
	);
	return existing;
}

export function maskValue(value) {
	if (!value) {
		return '(unset)';
	}
	if (value.length <= 8) {
		return '********';
	}
	return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

export function writeDeploySummary(write, summary) {
	write('Treeseed deployment summary');
	write(`  Target: ${summary.target}`);
	write(`  Worker: ${summary.workerName}`);
	write(`  Site URL: ${summary.siteUrl}`);
	write(`  Account ID: ${summary.accountId}`);
	write(`  D1: ${summary.siteDataDb.databaseName} (${summary.siteDataDb.databaseId})`);
	write(`  KV FORM_GUARD_KV: ${summary.formGuardKv.id}`);
}

export function syncManagedServiceSettingsFromDeployConfig(tenantRoot) {
	const config = loadMachineConfig(tenantRoot);
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const railway = config.settings.services.railway;
	railway.projectId = deployConfig.services?.api?.railway?.projectId
		?? railway.projectId;
	railway.projectName = deployConfig.services?.api?.railway?.projectName
		?? railway.projectName;
	railway.apiServiceId = deployConfig.services?.api?.railway?.serviceId ?? railway.apiServiceId;
	railway.apiServiceName = deployConfig.services?.api?.railway?.serviceName ?? railway.apiServiceName;

	const remote = normalizeRemoteSettings(config.settings.remote);
	const defaultHostBaseUrl = process.env[API_BASE_URL_ENV]
		?? deployConfig.services?.api?.environments?.prod?.baseUrl
		?? deployConfig.services?.api?.publicBaseUrl
		?? remote.hosts[0]?.baseUrl
		?? DEFAULT_API_BASE_URL;
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
	writeMachineConfig(tenantRoot, config);
	return config;
}
