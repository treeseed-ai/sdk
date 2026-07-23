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
import { ProjectPlatformScope, runPrefixedWranglerWithRetry, runWrangler } from './project-platform-scope.ts';

export type TenantCloudflareDeployContext = {
	tenantRoot: string;
	scope: ProjectPlatformScope;
	target: any;
	planOnly?: boolean;
	wranglerPath: string;
	databaseName: string;
	pagesProjectName: string | null;
	pagesBranchName: string | null;
	env: NodeJS.ProcessEnv | Record<string, string | undefined>;
	write?: TreeseedBootstrapWriter;
};

export function prepareTenantCloudflareDeploy({
	tenantRoot,
	scope,
	target: explicitTarget,
	planOnly,
	write,
	env = process.env,
}: {
	tenantRoot: string;
	scope: ProjectPlatformScope;
	target?: any;
	planOnly?: boolean;
	write?: TreeseedBootstrapWriter;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): TenantCloudflareDeployContext {
	const target = explicitTarget ?? createPersistentDeployTarget(scope === 'local' ? 'staging' : scope);
	if (scope !== 'local') {
		assertDeploymentInitialized(tenantRoot, { target });
		runTenantDeployPreflight({ cwd: tenantRoot, scope });
	}
	const { wranglerPath, deployConfig, state } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	if (scope !== 'local') {
		syncCloudflareSecrets(tenantRoot, { target, planOnly });
	}
	const deployState = loadDeployState(tenantRoot, deployConfig, { target });
	const pagesProjectName = target.kind === 'persistent' ? deployState.pages?.projectName ?? null : null;
	const pagesBranchName = target.kind === 'persistent'
		? (
			target.scope === 'prod'
				? deployState.pages?.productionBranch ?? 'main'
				: deployState.pages?.stagingBranch ?? 'staging'
		)
		: null;
	return {
		tenantRoot,
		scope,
		target,
		planOnly,
		wranglerPath,
		databaseName: state.d1Databases.SITE_DATA_DB.databaseName,
		pagesProjectName,
		pagesBranchName,
		env: {
			...process.env,
			...env,
			CLOUDFLARE_ACCOUNT_ID: resolveConfiguredCloudflareAccountId(deployConfig),
			...(target.kind === 'persistent' && target.scope !== 'local' ? { TREESEED_CONTENT_SERVING_MODE: 'published_runtime' } : {}),
		},
		write,
	};
}

export async function runTenantDataMigration(context: TenantCloudflareDeployContext) {
	if (context.planOnly) {
		writeTreeseedBootstrapLine(context.write, {
			scope: context.scope,
			system: 'data',
			task: 'd1-migrate',
			stage: 'deploy',
		}, `Plan: would apply remote migrations for ${context.databaseName}.`);
		return { databaseName: context.databaseName, planOnly: true };
	}
	await runPrefixedWranglerWithRetry(context.tenantRoot, [
		'd1',
		'migrations',
		'apply',
		context.databaseName,
		'--remote',
		'--config',
		context.wranglerPath,
	], {
		env: context.env,
		write: context.write,
		prefix: {
			scope: context.scope,
			system: 'data',
			task: 'd1-migrate',
			stage: 'deploy',
		},
	});
	return { databaseName: context.databaseName, planOnly: false };
}

export async function runTenantWebBuild(context: Pick<TenantCloudflareDeployContext, 'tenantRoot' | 'scope' | 'planOnly' | 'env' | 'write'>) {
	const prefix = {
		scope: context.scope,
		system: 'web',
		task: 'build',
		stage: 'deploy',
	};
	if (context.planOnly) {
		writeTreeseedBootstrapLine(context.write, prefix, 'Plan: skipped tenant build.');
		return { planOnly: true };
	}
	const result = await runPrefixedCommand(process.execPath, [packageScriptPath('tenant-build')], {
		cwd: context.tenantRoot,
		env: context.env,
		write: context.write,
		prefix,
	});
	if (result.status !== 0) {
		throw new Error('tenant-build failed.');
	}
	return { planOnly: false };
}

export async function runTenantWebPublish(context: TenantCloudflareDeployContext) {
	const prefix = {
		scope: context.scope,
		system: 'web',
		task: 'publish',
		stage: 'deploy',
	};
	if (context.planOnly) {
		if (context.pagesProjectName) {
			writeTreeseedBootstrapLine(context.write, prefix, `Plan: would deploy ${deployTargetLabel(context.target)} to Pages project ${context.pagesProjectName} from ${resolve(context.tenantRoot, 'dist')}.`);
		} else {
			writeTreeseedBootstrapLine(context.write, prefix, `Plan: would deploy ${deployTargetLabel(context.target)} with generated Wrangler config at ${resolve(context.wranglerPath)}.`);
		}
		return { planOnly: true };
	}
	if (context.pagesProjectName) {
		const args = [
			'pages',
			'deploy',
			resolve(context.tenantRoot, 'dist'),
			'--project-name',
			context.pagesProjectName,
		];
		if (context.pagesBranchName) {
			args.push('--branch', context.pagesBranchName);
		}
		await runPrefixedWranglerWithRetry(context.tenantRoot, args, {
			env: context.env,
			write: context.write,
			prefix,
		});
	} else {
		await runPrefixedWranglerWithRetry(context.tenantRoot, ['deploy', '--config', context.wranglerPath], {
			env: context.env,
			write: context.write,
			prefix,
		});
	}
	return { planOnly: false };
}

export function inferContentType(filePath: string) {
	const extension = extname(filePath).toLowerCase();
	if (extension === '.json') return 'application/json';
	if (extension === '.md') return 'text/markdown; charset=utf-8';
	if (extension === '.mdx') return 'text/mdx; charset=utf-8';
	return 'application/octet-stream';
}

export function writeTempFile(root: string, name: string, body: Buffer | string) {
	const filePath = resolve(root, name);
	writeFileSync(filePath, body);
	return filePath;
}

export function projectPlatformTempRoot(tenantRoot: string, scope: string) {
	const base = resolve(tenantRoot, '.treeseed', 'tmp', scope);
	mkdirSync(base, { recursive: true });
	return base;
}

export function toBuffer(body: string | ArrayBuffer | ArrayBufferView) {
	if (typeof body === 'string') {
		return Buffer.from(body);
	}
	if (body instanceof ArrayBuffer) {
		return Buffer.from(body);
	}
	return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

export function readR2JsonObject(
	tenantRoot: string,
	bucketName: string,
	objectKey: string,
	wranglerPath: string,
	wranglerEnv: Record<string, string | undefined>,
) {
	const tempRoot = mkdtempSync(join(projectPlatformTempRoot(tenantRoot, 'r2-read'), 'treeseed-r2-read-'));
	const filePath = resolve(tempRoot, basename(objectKey) || 'payload.json');
	try {
		const result = runWrangler(tenantRoot, [
			'r2',
			'object',
			'get',
			`${bucketName}/${objectKey}`,
			'--config',
			wranglerPath,
			'--remote',
			'--file',
			filePath,
		], wranglerEnv, { allowFailure: true });
		if (result.status !== 0 || !statSafe(filePath)) {
			return null;
		}
		return JSON.parse(readFileSync(filePath, 'utf8'));
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

export function statSafe(filePath: string) {
	try {
		return statSync(filePath);
	} catch {
		return null;
	}
}

export async function reportDeployment(
	reporter: ControlPlaneReporter,
	input: ControlPlaneDeploymentReport,
) {
	await reporter.reportDeployment(input);
}

export function summarizePostDeployHostingAudit(report: Awaited<ReturnType<typeof runTreeseedHostingAudit>>, phase: 'already_ready' | 'repaired') {
	const failedChecks = report.checks.filter((check) => check.status === 'failed').length;
	const repairedChecks = report.checks.filter((check) => check.status === 'repaired').length;
	return {
		ok: report.ok,
		phase,
		environment: report.environment,
		repairMode: report.repairMode,
		repaired: report.repaired || repairedChecks > 0,
		repairedChecks,
		failedChecks,
		blockers: report.blockers,
		warnings: report.warnings,
		checkedAt: report.checkedAt,
	};
}

export function hostingAuditHostKindsForSystems(systems: TreeseedRunnableBootstrapSystem[]) {
	const hostKinds = new Set<'repository' | 'web' | 'processing' | 'email'>();
	for (const system of systems) {
		if (system === 'github') {
			hostKinds.add('repository');
		} else if (system === 'data' || system === 'web') {
			hostKinds.add('web');
		} else if (system === 'api' || system === 'agents') {
			hostKinds.add('processing');
		}
	}
	return [...hostKinds];
}
