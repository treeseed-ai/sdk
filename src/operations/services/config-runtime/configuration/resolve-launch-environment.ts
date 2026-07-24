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
import { ConfigScope } from '../accounts/ensure-secret-session-for-config.ts';
import { CLI_CHECK_TIMEOUT_MS, CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER, maskValue, warnDeprecatedLocalEnvFiles } from './machine-config-relative-path.ts';
import { collectConfigSeedValueSources, collectEnvironmentContext, nonEmptyEnvironmentValues, resolveMachineEnvironmentValues } from '../support/resolve-entry-value-from-buckets.ts';
import { formatConfigSectionTitle } from '../support/summarize-persistent-readiness.ts';
import { listRelevantConfigEntries } from './list-relevant-config-entries.ts';

export function resolveLaunchEnvironment({
	tenantRoot,
	scope,
	baseEnv = process.env,
	overrides = {},
}: {
	tenantRoot: string;
	scope: ConfigScope;
	baseEnv?: NodeJS.ProcessEnv;
	overrides?: NodeJS.ProcessEnv;
}) {
	warnDeprecatedLocalEnvFiles(tenantRoot);
	let machineValues = {};
	try {
		machineValues = resolveMachineEnvironmentValues(tenantRoot, scope);
	} catch (error) {
		if (!(error instanceof KeyAgentError)) {
			throw error;
		}
	}
	const registry = collectEnvironmentContext(tenantRoot);
	const baseValues = nonEmptyEnvironmentValues(baseEnv);
	const seedValues = scope === 'local'
		? { ...baseValues, ...machineValues }
		: { ...machineValues, ...baseValues };
	const suggestedValues = getEnvironmentSuggestedValues({
		scope,
		purpose: 'deploy',
		deployConfig: registry.context.deployConfig,
		tenantConfig: registry.context.tenantConfig,
		plugins: registry.context.plugins,
		values: seedValues,
	});
	const nonSecretSuggestedValues = Object.fromEntries(
		registry.entries
			.filter((entry) => entry.sensitivity !== 'secret' && typeof suggestedValues[entry.id] === 'string' && suggestedValues[entry.id].length > 0)
			.map((entry) => [entry.id, suggestedValues[entry.id]]),
	);
	const systemSecretSuggestedValues = Object.fromEntries(
		registry.entries
			.filter((entry) =>
				entry.sensitivity === 'secret'
				&& entry.visibility === 'system'
				&& typeof entry.defaultValue === 'function'
				&& typeof suggestedValues[entry.id] === 'string'
				&& suggestedValues[entry.id].length > 0
			)
			.map((entry) => [entry.id, suggestedValues[entry.id]]),
	);
	const scopedValues = scope === 'local'
		? { ...nonSecretSuggestedValues, ...systemSecretSuggestedValues, ...baseValues, ...machineValues }
		: { ...nonSecretSuggestedValues, ...systemSecretSuggestedValues, ...machineValues, ...baseValues };
	return withServiceCredentialEnv({
		...scopedValues,
		...overrides,
	});
}

export function formatConfigEnvironmentReport({ tenantRoot, scope, env = process.env, revealSecrets = false }) {
	const registry = collectEnvironmentContext(tenantRoot);
	const { values, sources } = collectConfigSeedValueSources(tenantRoot, scope, env);
	const lines = [
		formatConfigSectionTitle(`Resolved environment values for ${scope}`),
		revealSecrets
			? 'Secrets are shown because --show-secrets was provided.'
			: 'Secret values are masked. Re-run with --show-secrets to print full values.',
	];

	for (const entry of listRelevantConfigEntries(registry, scope)) {
		const value = values[entry.id];
		const displayValue = typeof value === 'string' && value.length > 0
			? (entry.sensitivity === 'secret' && !revealSecrets ? maskValue(value) : value)
			: '(unset)';
		lines.push(`${entry.id}=${displayValue} (${sources[entry.id] ?? 'unset'})`);
	}

	return lines.join('\n');
}

export function applyEnvironmentToProcess({ tenantRoot, scope, override = false }) {
	let resolvedValues = {};
	try {
		resolvedValues = resolveLaunchEnvironment({ tenantRoot, scope });
	} catch (error) {
		if (!(error instanceof KeyAgentError)) {
			throw error;
		}
	}
	for (const [key, value] of Object.entries(resolvedValues)) {
		const currentValue = process.env[key] ?? '';
		const shouldReplacePlaceholder = key === 'CLOUDFLARE_ACCOUNT_ID' && currentValue === CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER;
		if ((override || currentValue.length === 0 || shouldReplacePlaceholder) && typeof value === 'string' && value.length > 0) {
			process.env[key] = value;
		}
	}
	return resolvedValues;
}

export function validateCommandEnvironment({ tenantRoot, scope, purpose }) {
	const registry = collectEnvironmentContext(tenantRoot);
	const values = resolveLaunchEnvironment({ tenantRoot, scope });
	const validation = filterValidationByWorkflowPlane(validateEnvironmentValues({
		values,
		scope,
		purpose,
		deployConfig: registry.context.deployConfig,
		tenantConfig: registry.context.tenantConfig,
		plugins: registry.context.plugins,
	}));
	return {
		registry,
		values,
		validation,
	};
}

export function filterValidationByWorkflowPlane(validation) {
	const plane = process.env.TREESEED_WORKFLOW_PLANE;
	if (plane !== 'web' && plane !== 'processing') {
		return validation;
	}
	const problemApplies = (problem) => doesEntryApplyToWorkflowPlane(problem.entry, plane);
	const missing = validation.missing.filter(problemApplies);
	const invalid = validation.invalid.filter(problemApplies);
	const entries = validation.entries.filter((entry) => doesEntryApplyToWorkflowPlane(entry, plane));
	const required = validation.required.filter((entry) => doesEntryApplyToWorkflowPlane(entry, plane));
	return {
		...validation,
		ok: missing.length === 0 && invalid.length === 0,
		entries,
		required,
		missing,
		invalid,
	};
}

export function doesEntryApplyToWorkflowPlane(entry, plane) {
	const targets = new Set(entry.targets ?? []);
	const hasProcessingTarget = targets.has('railway-secret') || targets.has('railway-var');
	const hasWebTarget = targets.has('cloudflare-secret') || targets.has('cloudflare-var') || targets.has('local-cloudflare');
	const hasWorkflowTarget = targets.has('github-secret') || targets.has('github-variable');

	if (plane === 'web') {
		return !hasProcessingTarget || hasWebTarget || hasWorkflowTarget;
	}
	if (plane === 'processing') {
		return !hasWebTarget || hasProcessingTarget || hasWorkflowTarget;
	}
	return true;
}

export function assertCommandEnvironment({ tenantRoot, scope, purpose }) {
	const report = validateCommandEnvironment({ tenantRoot, scope, purpose });
	if (report.validation.ok) {
		return report;
	}

	const lines = [
		`Treeseed environment is not ready for ${purpose} (${scope}).`,
		'Run `treeseed config` to fill in the missing values, or export them in the current shell.',
	];

	for (const problem of [...report.validation.missing, ...report.validation.invalid]) {
		lines.push(`- ${problem.message}`);
	}

	const error = new Error(lines.join('\n'));
	error.kind = report.validation.missing.length > 0 ? 'missing_config' : 'invalid_config';
	error.details = report.validation;
	throw error;
}

export function runGh(args, { cwd, planOnly = false, input, env } = {}) {
	if (planOnly) {
		return { status: 0, stdout: '', stderr: '' };
	}
	const gh = resolveToolBinary('gh', { env });
	if (!gh) {
		throw new Error('GitHub CLI `gh` is not installed.');
	}
	const result = spawnSync(gh, args, {
		cwd,
		stdio: input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
		input,
		timeout: 15000,
		env: createManagedToolEnv({ ...process.env, ...(env ?? {}) }),
	});
	if (result.error?.code === 'ETIMEDOUT') {
		throw new Error(`gh ${args.join(' ')} timed out`);
	}
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `gh ${args.join(' ')} failed`);
	}
	return result;
}

export function commandAvailable(command) {
	if (command === 'gh' || command === 'wrangler' || command === 'railway' || command === 'copilot') {
		return Boolean(resolveToolBinary(command));
	}
	const result = spawnSync('bash', ['-lc', `command -v ${command}`], {
		stdio: 'pipe',
		encoding: 'utf8',
	});
	return result.status === 0;
}

export function checkCommand(command, args, { cwd, env } = {}) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
		env: { ...process.env, ...(env ?? {}) },
		timeout: CLI_CHECK_TIMEOUT_MS,
	});
	const timedOut = result.error && 'code' in result.error && result.error.code === 'ETIMEDOUT';
	const detail = timedOut
		? `Command timed out after ${CLI_CHECK_TIMEOUT_MS}ms: ${command} ${args.join(' ')}`
		: `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim();
	return {
		ok: result.status === 0,
		status: result.status ?? 1,
		stdout: result.stdout?.trim() ?? '',
		stderr: result.stderr?.trim() ?? '',
		detail,
	};
}

export function toolStatus(name, available, detail, extra = {}) {
	return {
		name,
		available,
		detail,
		...extra,
	};
}
