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
import { CLI_CHECK_TIMEOUT_MS, CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER, maskValue, warnDeprecatedTreeseedLocalEnvFiles } from './machine-config-relative-path.ts';
import { collectTreeseedConfigSeedValueSources, collectTreeseedEnvironmentContext, nonEmptyEnvironmentValues, resolveTreeseedMachineEnvironmentValues } from './resolve-entry-value-from-buckets.ts';
import { formatConfigSectionTitle } from './summarize-persistent-readiness.ts';
import { listRelevantTreeseedConfigEntries } from './list-relevant-treeseed-config-entries.ts';

export function resolveTreeseedLaunchEnvironment({
	tenantRoot,
	scope,
	baseEnv = process.env,
	overrides = {},
}: {
	tenantRoot: string;
	scope: TreeseedConfigScope;
	baseEnv?: NodeJS.ProcessEnv;
	overrides?: NodeJS.ProcessEnv;
}) {
	warnDeprecatedTreeseedLocalEnvFiles(tenantRoot);
	let machineValues = {};
	try {
		machineValues = resolveTreeseedMachineEnvironmentValues(tenantRoot, scope);
	} catch (error) {
		if (!(error instanceof TreeseedKeyAgentError)) {
			throw error;
		}
	}
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const baseValues = nonEmptyEnvironmentValues(baseEnv);
	const seedValues = scope === 'local'
		? { ...baseValues, ...machineValues }
		: { ...machineValues, ...baseValues };
	const suggestedValues = getTreeseedEnvironmentSuggestedValues({
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
	return withTreeseedServiceCredentialEnv({
		...scopedValues,
		...overrides,
	});
}

export function formatTreeseedConfigEnvironmentReport({ tenantRoot, scope, env = process.env, revealSecrets = false }) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const { values, sources } = collectTreeseedConfigSeedValueSources(tenantRoot, scope, env);
	const lines = [
		formatConfigSectionTitle(`Resolved environment values for ${scope}`),
		revealSecrets
			? 'Secrets are shown because --show-secrets was provided.'
			: 'Secret values are masked. Re-run with --show-secrets to print full values.',
	];

	for (const entry of listRelevantTreeseedConfigEntries(registry, scope)) {
		const value = values[entry.id];
		const displayValue = typeof value === 'string' && value.length > 0
			? (entry.sensitivity === 'secret' && !revealSecrets ? maskValue(value) : value)
			: '(unset)';
		lines.push(`${entry.id}=${displayValue} (${sources[entry.id] ?? 'unset'})`);
	}

	return lines.join('\n');
}

export function applyTreeseedEnvironmentToProcess({ tenantRoot, scope, override = false }) {
	let resolvedValues = {};
	try {
		resolvedValues = resolveTreeseedLaunchEnvironment({ tenantRoot, scope });
	} catch (error) {
		if (!(error instanceof TreeseedKeyAgentError)) {
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

export function validateTreeseedCommandEnvironment({ tenantRoot, scope, purpose }) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const values = resolveTreeseedLaunchEnvironment({ tenantRoot, scope });
	const validation = filterValidationByWorkflowPlane(validateTreeseedEnvironmentValues({
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

export function assertTreeseedCommandEnvironment({ tenantRoot, scope, purpose }) {
	const report = validateTreeseedCommandEnvironment({ tenantRoot, scope, purpose });
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
	const gh = resolveTreeseedToolBinary('gh', { env });
	if (!gh) {
		throw new Error('GitHub CLI `gh` is not installed.');
	}
	const result = spawnSync(gh, args, {
		cwd,
		stdio: input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
		input,
		timeout: 15000,
		env: createTreeseedManagedToolEnv({ ...process.env, ...(env ?? {}) }),
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
		return Boolean(resolveTreeseedToolBinary(command));
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
