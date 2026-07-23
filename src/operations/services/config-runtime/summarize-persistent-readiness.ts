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
import { TreeseedConfigScope } from './ensure-treeseed-secret-session-for-config.ts';

export async function summarizePersistentReadiness(
	tenantRoot,
	scope,
	validation,
	connectionChecks,
	env = process.env,
	{ includeReconcileStatus = true, systems }: {
		includeReconcileStatus?: boolean;
		systems?: TreeseedRunnableBootstrapSystem[];
	} = {},
) {
	const validationProblems = [...validation.missing, ...validation.invalid];
	const validationBlockers = validationProblems.map((problem) => problem.message);
	const connectionReady = connectionChecks.every((check) => check.ready || check.skipped);
	const connectionIssues = connectionChecks
		.filter((check) => !check.ready && !check.skipped)
		.map((check) => `${check.provider}: ${check.detail}`);
	const connectionWarnings = connectionChecks
		.filter((check) => check.skipped)
		.map((check) => `${check.provider}: ${check.detail}`);

	if (scope === 'local') {
		return {
			configured: validation.ok,
			provisioned: true,
			deployable: validation.ok && connectionReady,
			phase: validation.ok ? 'code_ready' : 'config_incomplete',
			blockers: [
				...validationBlockers,
				...connectionIssues,
			],
			warnings: connectionWarnings,
			checks: {
				validation: validation.ok,
				connections: connectionReady,
			},
		};
	}

	if (!validation.ok) {
		return {
			configured: false,
			provisioned: false,
			deployable: false,
			phase: 'config_incomplete',
			blockers: [
				...validationBlockers,
				...connectionIssues,
			],
			warnings: connectionWarnings,
			checks: {
				validation: false,
				connections: connectionReady,
				cloudflare: null,
				railway: false,
			},
		};
	}

	const configured = validation.ok;
	if (!includeReconcileStatus) {
		return {
			configured,
			provisioned: false,
			deployable: false,
			phase: 'config_complete',
			blockers: [...connectionIssues],
			warnings: connectionWarnings,
			checks: {
				validation: validation.ok,
				connections: connectionReady,
				reconcile: 'deferred',
			},
		};
	}

	const reconcile = await collectTreeseedReconcileStatus({
		tenantRoot,
		target: createPersistentDeployTarget(scope),
		env,
		systems,
	});
	const provisioned = reconcile.ready;
	const deployable = configured && provisioned && connectionReady;
	const blockers = [...connectionIssues, ...reconcile.blockers];
	return {
		configured,
		provisioned,
		deployable,
		phase: provisioned ? 'provisioned' : 'config_complete',
		blockers,
		warnings: [...connectionWarnings, ...reconcile.warnings],
		checks: {
			validation: validation.ok,
			connections: connectionReady,
			reconcile: reconcile.units,
		},
	};
}

export function summarizeReconciledPersistentReadiness(
	scope,
	validation,
	connectionChecks,
	reconciled,
) {
	const validationProblems = [...validation.missing, ...validation.invalid];
	const validationBlockers = validationProblems.map((problem) => problem.message);
	const connectionReady = connectionChecks.every((check) => check.ready || check.skipped);
	const connectionIssues = connectionChecks
		.filter((check) => !check.ready && !check.skipped)
		.map((check) => `${check.provider}: ${check.detail}`);
	const connectionWarnings = connectionChecks
		.filter((check) => check.skipped)
		.map((check) => `${check.provider}: ${check.detail}`);
	if (scope === 'local') {
		return {
			configured: validation.ok,
			provisioned: true,
			deployable: validation.ok && connectionReady,
			phase: validation.ok ? 'code_ready' : 'config_incomplete',
			blockers: [
				...validationBlockers,
				...connectionIssues,
			],
			warnings: connectionWarnings,
			checks: {
				validation: validation.ok,
				connections: connectionReady,
			},
		};
	}
	if (!validation.ok) {
		return {
			configured: false,
			provisioned: false,
			deployable: false,
			phase: 'config_incomplete',
			blockers: [
				...validationBlockers,
				...connectionIssues,
			],
			warnings: connectionWarnings,
			checks: {
				validation: false,
				connections: connectionReady,
				reconcile: [],
			},
		};
	}
	const actions = reconciled?.actions ?? [];
	const blockers = actions
		.filter((action) => action.verified !== true)
		.flatMap((action) => [
			...action.missing.map((entry) => `${action.provider}:${action.unitType}: ${entry}`),
			...action.drifted.map((entry) => `${action.provider}:${action.unitType}: ${entry}`),
		]);
	const provisioned = blockers.length === 0 && actions.length > 0;
	return {
		configured: true,
		provisioned,
		deployable: provisioned && connectionReady,
		phase: provisioned ? 'provisioned' : 'config_complete',
		blockers: [
			...connectionIssues,
			...blockers,
		],
		warnings: connectionWarnings,
		checks: {
			validation: true,
			connections: connectionReady,
			reconcile: actions,
		},
	};
}

export function formatTreeseedConfigValidationFailure(
	validations: Record<TreeseedConfigScope, ReturnType<typeof validateTreeseedEnvironmentValues>>,
	scopes: TreeseedConfigScope[],
) {
	const lines = ['Treeseed config validation failed.'];
	for (const scope of scopes) {
		const validation = validations[scope];
		if (!validation || validation.ok) {
			continue;
		}
		lines.push('');
		lines.push(`${scope}:`);
		for (const problem of [...validation.missing, ...validation.invalid]) {
			const targets = problem.entry.targets.length > 0 ? ` Targets: ${problem.entry.targets.join(', ')}.` : '';
			const source = problem.entry.sourceRequirement
				? ` Source: ${problem.entry.sourceRequirement}${problem.entry.sourceProvider ? ` (${problem.entry.sourceProvider})` : ''}.`
				: '';
			lines.push(`- ${problem.id}: ${problem.message}${targets}${source}`);
		}
	}
	return lines.join('\n');
}

export function colorize(value, code) {
	return `\u001b[${code}m${value}\u001b[0m`;
}

export function formatConfigSectionTitle(label) {
	return colorize(`\n== ${label}`, '1;36');
}

export function hasConfigValue(values, key) {
	return typeof values[key] === 'string' && values[key].trim().length > 0;
}

export function createConfigReadiness(values, validation) {
	const invalidIds = new Set([
		...(validation?.invalid ?? []).map((problem) => problem.id),
	]);
	const validConfigValue = (key: string) => hasConfigValue(values, key) && !invalidIds.has(key);
	const configProblems = [
		...(validation?.missing ?? []),
		...(validation?.invalid ?? []),
	];
	const providerIssues = (provider: 'github' | 'cloudflare' | 'railway') =>
		configProblems.filter((problem) => {
			if (provider === 'github') {
				return problem.id === 'TREESEED_GITHUB_TOKEN' || problem.entry.group === 'github';
			}
			if (provider === 'cloudflare') {
				return problem.id.startsWith('TREESEED_CLOUDFLARE_') || problem.id.startsWith('CLOUDFLARE_')
					|| problem.id.includes('TURNSTILE')
					|| problem.entry.group === 'cloudflare';
			}
			return problem.id.startsWith('TREESEED_RAILWAY_') || problem.entry.group === 'railway';
		});
	const localDevelopmentIssues = [
		...configProblems,
	].filter((problem) => problem.entry.group === 'local-development');
	return {
		github: {
			configured: Boolean(resolveTreeseedGitHubToken(values)) && providerIssues('github').length === 0,
		},
		cloudflare: {
			configured: providerIssues('cloudflare').length === 0,
		},
		railway: {
			configured: validConfigValue('TREESEED_RAILWAY_API_TOKEN') && providerIssues('railway').length === 0,
		},
		localDevelopment: {
			configured: localDevelopmentIssues.length === 0,
		},
	};
}

export const CONFIG_GROUP_ORDER = ['auth', 'github', 'cloudflare', 'railway', 'local-development', 'forms', 'smtp'];

export function configGroupRank(group) {
	const index = CONFIG_GROUP_ORDER.indexOf(group);
	return index === -1 ? CONFIG_GROUP_ORDER.length : index;
}
