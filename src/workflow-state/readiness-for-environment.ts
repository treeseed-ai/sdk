import { spawnSync } from 'node:child_process';
import { collectTreeseedConfigSeedValues, resolveTreeseedMachineEnvironmentValues, resolveTreeseedRemoteSession, collectTreeseedEnvironmentContext, withTreeseedKeyAgentAutopromptDisabled } from ".././operations/services/config-runtime.ts";
import { resolveTreeseedGitHubToken } from ".././service-credentials.ts";
import { resolveWranglerBin } from ".././operations/services/runtime-tools.ts";
import { getTreeseedEnvironmentSuggestedValues, validateTreeseedEnvironmentValues } from ".././platform/environment.ts";
import { createTreeseedManagedToolEnv, resolveTreeseedToolCommand } from ".././managed-dependencies.ts";
import { TreeseedWorkflowProviderCheck, TreeseedWorkflowState, TreeseedWorkflowStatusOptions, runGit } from './treeseed-branch-role.ts';

export function readinessForEnvironment(state: TreeseedWorkflowState, scope: 'local' | 'staging' | 'prod') {
	const blockers = [...state.persistentEnvironments[scope].blockers];
	const warnings = [...state.persistentEnvironments[scope].warnings];

	if (!state.deployConfigPresent) {
		blockers.push('Missing treeseed.site.yaml.');
	}
	if (!state.files.machineConfig) {
		blockers.push('Missing Treeseed machine config.');
	}
	if (!state.secrets.wrappedKeyPresent) {
		blockers.push('Missing wrapped Treeseed machine key.');
	}
	if (state.secrets.migrationRequired) {
		blockers.push('Treeseed machine key migration is still required.');
	}
	if (scope !== 'local') {
		if (!state.persistentEnvironments[scope].initialized) {
			blockers.push(`Environment ${scope} is not initialized.`);
		}
		if (state.persistentEnvironments[scope].configured && !state.persistentEnvironments[scope].provisioned) {
			warnings.push(`Environment ${scope} is configured but foundational infrastructure has not been provisioned yet.`);
		}
	}

	return {
		ready: blockers.length === 0,
		blockers,
		warnings,
	};
}

export function safeResolveRemoteSession(cwd: string, hostId?: string | null) {
	try {
		return withTreeseedKeyAgentAutopromptDisabled(() => resolveTreeseedRemoteSession(cwd, hostId ?? undefined));
	} catch {
		return null;
	}
}

export function safeResolveMachineEnvironmentValues(cwd: string, scope: 'local' | 'staging' | 'prod') {
	try {
		return withTreeseedKeyAgentAutopromptDisabled(() => resolveTreeseedMachineEnvironmentValues(cwd, scope));
	} catch {
		return {};
	}
}

export function collectStatusConfigScope(
	cwd: string,
	scope: 'local' | 'staging' | 'prod',
	environmentContext: ReturnType<typeof collectTreeseedEnvironmentContext>,
	env: NodeJS.ProcessEnv = process.env,
) {
	const values = collectTreeseedConfigSeedValues(cwd, scope, env);
	const suggestedValues = getTreeseedEnvironmentSuggestedValues({
		scope,
		purpose: 'config',
		deployConfig: environmentContext.context.deployConfig,
		tenantConfig: environmentContext.context.tenantConfig,
		plugins: environmentContext.context.plugins,
		values,
	});
	const validation = validateTreeseedEnvironmentValues({
		values: {
			...suggestedValues,
			...values,
		},
		scope,
		purpose: 'config',
		deployConfig: environmentContext.context.deployConfig,
		tenantConfig: environmentContext.context.tenantConfig,
		plugins: environmentContext.context.plugins,
	});
	return {
		values,
		suggestedValues,
		resolvedValues: {
			...suggestedValues,
			...values,
		} as Record<string, string>,
		validation,
	};
}

export function providerProblems(
	validation: ReturnType<typeof validateTreeseedEnvironmentValues>,
	provider: 'github' | 'cloudflare' | 'railway' | 'localDevelopment',
) {
	const problems = [...validation.missing, ...validation.invalid];
	return problems.filter((problem) => {
		const id = problem.id.toUpperCase();
		const group = problem.entry.group;
		if (provider === 'github') {
			return id === 'TREESEED_GITHUB_TOKEN' || group === 'github';
		}
		if (provider === 'cloudflare') {
			return id.startsWith('CLOUDFLARE_') || id.includes('TURNSTILE') || group === 'cloudflare';
		}
		if (provider === 'railway') {
			return id.startsWith('RAILWAY_') || group === 'railway';
		}
		return group === 'local-development';
	});
}

export function isCloudflareProviderProblem(problem: { id: string; entry: { group?: string } }) {
	const id = problem.id.toUpperCase();
	return id.startsWith('CLOUDFLARE_') || id.includes('TURNSTILE') || problem.entry.group === 'cloudflare';
}

export function liveCheckResult(configured: boolean, live?: TreeseedWorkflowProviderCheck['live']): TreeseedWorkflowProviderCheck {
	return live ? { configured, live } : { configured };
}

export function spawnLiveCheck(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
	const result = spawnSync(command, args, {
		cwd,
		env: { ...process.env, ...env },
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: 15000,
	});
	const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim();
	return {
		ok: result.status === 0,
		detail: output || (result.status === 0 ? 'Provider check succeeded.' : `Provider check failed with status ${result.status ?? 'unknown'}.`),
	};
}

export function providerLiveCheck(provider: 'github' | 'cloudflare' | 'railway', configured: boolean, cwd: string, env: NodeJS.ProcessEnv) {
	if (!configured) {
		return { checked: true, ready: false, skipped: true, detail: `${provider} token/config is missing.` };
	}
	try {
		const result = (() => {
			if (provider === 'github') {
				const gh = resolveTreeseedToolCommand('gh', { env });
				if (!gh) return { ok: false, detail: 'GitHub CLI `gh` is unavailable.' };
				return spawnLiveCheck(gh.command, [...gh.argsPrefix, 'api', 'user', '--jq', '.login'], cwd, createTreeseedManagedToolEnv(env));
			}
			if (provider === 'cloudflare') {
				return spawnLiveCheck(process.execPath, [resolveWranglerBin(), 'whoami'], cwd, env);
			}
			const railway = resolveTreeseedToolCommand('railway', { env });
			if (!railway) return { ok: false, detail: 'Railway CLI is unavailable.' };
			return spawnLiveCheck(railway.command, [...railway.argsPrefix, 'whoami'], cwd, env);
		})();
		return {
			checked: true,
			ready: result.ok,
			detail: result.detail,
		};
	} catch (error) {
		return {
			checked: true,
			ready: false,
			detail: error instanceof Error ? error.message : `${provider} live check failed.`,
		};
	}
}

export function providerStatusForScope(
	cwd: string,
	scope: 'local' | 'staging' | 'prod',
	statusConfig: ReturnType<typeof collectStatusConfigScope>,
	options: TreeseedWorkflowStatusOptions,
) {
	const values = statusConfig.values;
	const githubConfigured = Boolean(resolveTreeseedGitHubToken(values));
	const cloudflareConfigured = typeof values.TREESEED_CLOUDFLARE_API_TOKEN === 'string' && values.TREESEED_CLOUDFLARE_API_TOKEN.trim().length > 0;
	const railwayConfigured = typeof values.TREESEED_RAILWAY_API_TOKEN === 'string' && values.TREESEED_RAILWAY_API_TOKEN.trim().length > 0;
	const localDevelopmentConfigured = providerProblems(statusConfig.validation, 'localDevelopment').length === 0;
	const live = options.live === true;
	const env = statusConfig.resolvedValues as NodeJS.ProcessEnv;
	const cloudflare = scope === 'local'
		? {
			configured: cloudflareConfigured,
			applicable: false,
			detail: cloudflareConfigured
				? 'Cloudflare is used locally only for optional AI-backed features.'
				: 'Cloudflare provider deployment is not used for the local runtime.',
			...(live ? { live: { checked: true, ready: true, skipped: true, detail: 'Wrangler provider checks are not used for the local runtime.' } } : {}),
		}
		: liveCheckResult(cloudflareConfigured, live ? providerLiveCheck('cloudflare', cloudflareConfigured, cwd, env) : undefined);
	const railway = scope === 'local'
		? {
			configured: true,
			applicable: false,
			detail: 'Railway services run locally in the local environment.',
			...(live ? { live: { checked: true, ready: true, skipped: true, detail: 'Railway is not used for the local environment.' } } : {}),
		}
		: liveCheckResult(railwayConfigured, live ? providerLiveCheck('railway', railwayConfigured, cwd, env) : undefined);
	return {
		github: liveCheckResult(githubConfigured, live ? providerLiveCheck('github', githubConfigured, cwd, env) : undefined),
		cloudflare,
		railway,
		localDevelopment: {
			configured: localDevelopmentConfigured,
			...(live ? { live: { checked: true, ready: localDevelopmentConfigured, skipped: true, detail: 'Local development readiness is validated from saved configuration.' } } : {}),
		},
	};
}

export function hasStatusConfigValue(
	statusConfigByScope: Record<'local' | 'staging' | 'prod', ReturnType<typeof collectStatusConfigScope>>,
	key: string,
) {
	return (['local', 'staging', 'prod'] as const).some((scope) => {
		const value = statusConfigByScope[scope].values[key];
		return typeof value === 'string' && value.trim().length > 0;
	});
}

export function knownRemoteTrackingBranchExists(repoDir: string, branchName: string) {
	try {
		runGit(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`], { cwd: repoDir, capture: true });
		return true;
	} catch {
		return false;
	}
}

export function safeHeadCommit(repoDir: string) {
	try {
		return runGit(['rev-parse', 'HEAD'], { cwd: repoDir, capture: true }).trim();
	} catch {
		return null;
	}
}
