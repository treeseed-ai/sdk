import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runTreeseedGit } from '../git-runner.ts';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { elapsedMs, formatTimingMarkdown, formatTimingSummary, type TreeseedTimingEntry } from '../../../timing.ts';
import {
	createControlPlaneReporter,
	type ControlPlaneDeploymentReport,
	type ControlPlaneReporter,
} from '../../../control-plane.ts';
import {
	resolvePublishedContentPreviewTtlHours,
	resolveTeamScopedContentLocator,
	signEditorialPreviewToken,
	type PublishedContentManifest,
	type PublishedContentObjectPointer,
} from '../../../platform/published-content.ts';
import { createPublishedContentPipeline } from '../../../platform/published-content-pipeline.ts';
import { collectTreeseedReconcileStatus, reconcileTreeseedTarget, resolveTreeseedBootstrapSelection } from '../../../reconcile/index.ts';
import { loadTreeseedManifest } from '../../../platform/tenant-config.ts';
import { applyTreeseedEnvironmentToProcess, assertTreeseedCommandEnvironment } from '../config-runtime.ts';
import { runTreeseedHostingAudit } from '../hosting-audit.ts';
import {
	assertDeploymentInitialized,
	createPersistentDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	loadDeployState,
	markDeploymentInitialized,
	purgePublishedContentCaches,
	resolveConfiguredCloudflareAccountId,
	resolveConfiguredSurfaceBaseUrl,
	resolveTreeseedResourceIdentity,
	runRemoteD1Migrations,
	syncCloudflareSecrets,
	writeDeployState,
} from '../deploy.ts';
import { currentManagedBranch, PRODUCTION_BRANCH, STAGING_BRANCH } from '../git-workflow.ts';
import {
	configuredRailwayServices,
	deployRailwayService,
	ensureRailwayScheduledJobs,
	validateRailwayDeployPrerequisites,
	validateRailwayServiceConfiguration,
	verifyRailwayManagedResources,
	verifyRailwayScheduledJobs,
} from '../railway-deploy.ts';
import { loadCliDeployConfig, packageScriptPath } from '../runtime-tools.ts';
import { resolveTreeseedToolCommand } from '../../../managed-dependencies.ts';
import type { TreeseedRunnableBootstrapSystem } from '../../../reconcile/index.ts';
import { runPrefixedCommand, runTreeseedBootstrapDag, sleep, writeTreeseedBootstrapLine, type TreeseedBootstrapDagNode, type TreeseedBootstrapExecution, type TreeseedBootstrapTaskPrefix, type TreeseedBootstrapWriter } from '../bootstrap-runner.ts';
import { runTenantDeployPreflight } from '../save-deploy-preflight.ts';


export type ProjectPlatformScope = 'local' | 'staging' | 'prod';

export type ProjectPlatformAction = 'deploy_web' | 'publish_content' | 'monitor';

export type ProjectPlatformContentPublishMode = 'production' | 'editorial_overlay';

export interface ProjectPlatformActionOptions {
	tenantRoot: string;
	scope: ProjectPlatformScope;
	projectId?: string | null;
	previewId?: string | null;
	planOnly?: boolean;
	reporter?: ControlPlaneReporter;
	skipProvision?: boolean;
	bootstrapSystems?: TreeseedRunnableBootstrapSystem[];
	bootstrapExecution?: TreeseedBootstrapExecution;
	write?: TreeseedBootstrapWriter;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export const PROJECT_PLATFORM_BOOTSTRAP_SYSTEMS: TreeseedRunnableBootstrapSystem[] = ['data', 'web', 'api', 'agents'];

export const WEB_PLATFORM_BOOTSTRAP_SYSTEMS: TreeseedRunnableBootstrapSystem[] = ['data', 'web'];

export const PROCESSING_PLATFORM_BOOTSTRAP_SYSTEMS: TreeseedRunnableBootstrapSystem[] = ['api', 'agents'];

export function stableHash(value: Buffer | string) {
	return createHash('sha256').update(value).digest('hex');
}

export function recordTiming(timings: TreeseedTimingEntry[], name: string, startMs: number, status = 'success', metadata?: Record<string, unknown>) {
	const entry: TreeseedTimingEntry = {
		name,
		durationMs: elapsedMs(startMs),
		status,
		...(metadata ? { metadata } : {}),
	};
	timings.push(entry);
	return entry;
}

export function writeWorkflowStatus(message: string) {
	if (!process.env.TREESEED_WORKFLOW_ACTION && !process.env.TREESEED_WORKFLOW_DEBUG) {
		return;
	}
	process.stderr.write(`[project-platform] ${message}\n`);
}

export async function timedPhase<T>(
	timings: TreeseedTimingEntry[],
	name: string,
	run: () => Promise<T> | T,
	metadata?: Record<string, unknown>,
) {
	const startMs = performance.now();
	try {
		const result = await Promise.resolve(run());
		recordTiming(timings, name, startMs, 'success', metadata);
		return result;
	} catch (error) {
		recordTiming(timings, name, startMs, 'failed', {
			...(metadata ?? {}),
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

export function writeProviderTimingSummary(options: ProjectPlatformActionOptions, timings: TreeseedTimingEntry[]) {
	const text = formatTimingSummary(timings);
	options.write?.(text);
	const summaryPath = String(options.env?.TREESEED_PROVIDER_TIMING_SUMMARY_PATH ?? process.env.TREESEED_PROVIDER_TIMING_SUMMARY_PATH ?? '').trim();
	if (!summaryPath) {
		return;
	}
	writeFileSync(summaryPath, formatTimingMarkdown(timings), { flag: 'a' });
}

export function inferEnvironmentFromBranch(tenantRoot: string) {
	const branch = currentManagedBranch(tenantRoot);
	if (branch === STAGING_BRANCH) {
		return 'staging';
	}
	if (branch === PRODUCTION_BRANCH) {
		return 'prod';
	}
	return 'staging';
}

export function resolveScope(environment: string | null) {
	const scope = environment ?? (process.env.CI ? inferEnvironmentFromBranch(process.cwd()) : 'local');
	if (!['local', 'staging', 'prod'].includes(scope)) {
		throw new Error(`Unsupported environment "${scope}". Expected local, staging, or prod.`);
	}
	return scope as ProjectPlatformScope;
}

export function currentCommit(tenantRoot: string) {
	const result = runTreeseedGit(['rev-parse', 'HEAD'], {
		cwd: tenantRoot,
		mode: 'read',
		allowFailure: true,
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

export function currentRef(tenantRoot: string) {
	const result = runTreeseedGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
		cwd: tenantRoot,
		mode: 'read',
		allowFailure: true,
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

export function sanitizeSegment(value: string | null | undefined, fallback: string) {
	const normalized = String(value ?? '')
		.trim()
		.replaceAll(/[\\/]+/g, '-')
		.replaceAll(/[^a-zA-Z0-9._-]+/g, '-')
		.replaceAll(/-+/g, '-')
		.replaceAll(/^-|-$/g, '');
	return normalized || fallback;
}

export function runNodeScript(tenantRoot: string, scriptName: string, scriptArgs: string[] = []) {
	const result = spawnSync(process.execPath, [packageScriptPath(scriptName), ...scriptArgs], {
		cwd: tenantRoot,
		stdio: 'inherit',
		env: { ...process.env },
	});
	if (result.status !== 0) {
		throw new Error(`${scriptName} failed.`);
	}
}

export function resolveProjectPlatformBootstrapSystems(
	options: ProjectPlatformActionOptions,
	siteConfig = loadCliDeployConfig(options.tenantRoot),
) {
	if (options.bootstrapSystems && options.bootstrapSystems.length > 0) {
		return [...options.bootstrapSystems];
	}
	const selection = resolveTreeseedBootstrapSelection({
		deployConfig: siteConfig,
		env: { ...process.env, ...(options.env ?? {}) },
		systems: PROJECT_PLATFORM_BOOTSTRAP_SYSTEMS,
		skipUnavailable: true,
	});
	for (const skipped of selection.skipped) {
		writeTreeseedBootstrapLine(
			options.write,
			{
				scope: options.scope,
				system: skipped.system,
				task: 'availability',
				stage: 'skip',
			},
			skipped.reason,
		);
	}
	return selection.runnable.filter((system) => system !== 'github');
}

export function runTenantPublishContentPreflight(options: ProjectPlatformActionOptions) {
	const target = createPersistentDeployTarget(options.scope === 'local' ? 'staging' : options.scope);
	applyTreeseedEnvironmentToProcess({ tenantRoot: options.tenantRoot, scope: options.scope, override: true });
	if (options.scope !== 'local') {
		assertTreeseedCommandEnvironment({
			tenantRoot: options.tenantRoot,
			scope: options.scope,
			purpose: 'deploy',
		});
		assertDeploymentInitialized(options.tenantRoot, { target });
	}
	return target;
}

export function runWrangler(
	tenantRoot: string,
	args: string[],
	extraEnv: Record<string, string | undefined> = {},
	options: { capture?: boolean; allowFailure?: boolean } = {},
) {
	const wrangler = resolveTreeseedToolCommand('wrangler');
	if (!wrangler) {
		throw new Error('Wrangler CLI is unavailable.');
	}
	const result = spawnSync(wrangler.command, [...wrangler.argsPrefix, ...args], {
		cwd: tenantRoot,
		stdio: options.capture ? 'pipe' : 'inherit',
		encoding: options.capture ? 'utf8' : undefined,
		env: { ...process.env, ...extraEnv },
	});
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(`wrangler ${args.join(' ')} failed`);
	}
	return result;
}

export const WRANGLER_TRANSIENT_MAX_ATTEMPTS = 6;

export const WRANGLER_COMMAND_TIMEOUT_MS = 180_000;

export function wranglerTransientRetryDelayMs(attempt: number) {
	return Math.min(5000 * 2 ** (attempt - 1), 60000);
}

export function isTransientWranglerOutput(output: string) {
	return /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|connectivity issue|internal error|code:\s*7500|aborted/i.test(output);
}

export async function runPrefixedWranglerWithRetry(
	tenantRoot: string,
	args: string[],
	{
		env = {},
		write,
		prefix,
	}: {
		env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
		write?: TreeseedBootstrapWriter;
		prefix: TreeseedBootstrapTaskPrefix;
	},
) {
	let lastOutput = '';
	for (let attempt = 1; attempt <= WRANGLER_TRANSIENT_MAX_ATTEMPTS; attempt += 1) {
		const wrangler = resolveTreeseedToolCommand('wrangler');
		if (!wrangler) {
			throw new Error('Wrangler CLI is unavailable.');
		}
		const result = await runPrefixedCommand(wrangler.command, [...wrangler.argsPrefix, ...args], {
			cwd: tenantRoot,
			env,
			write,
			prefix,
			timeoutMs: WRANGLER_COMMAND_TIMEOUT_MS,
		});
		if (result.status === 0) {
			return result;
		}
		lastOutput = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join('\n');
		if (attempt === WRANGLER_TRANSIENT_MAX_ATTEMPTS || !isTransientWranglerOutput(lastOutput)) {
			throw new Error(lastOutput || `wrangler ${args.join(' ')} failed`);
		}
		const retryDelayMs = wranglerTransientRetryDelayMs(attempt);
		writeTreeseedBootstrapLine(
			write,
			{ ...prefix, stage: 'retry' },
			`Wrangler command hit a transient failure; retrying in ${Math.round(retryDelayMs / 1000)}s...`,
			'stderr',
		);
		await sleep(retryDelayMs);
	}
	throw new Error(lastOutput || `wrangler ${args.join(' ')} failed`);
}
