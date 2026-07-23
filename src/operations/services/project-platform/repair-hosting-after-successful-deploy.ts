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
import { ProjectPlatformActionOptions, runPrefixedWranglerWithRetry, runWrangler, stableHash } from './project-platform-scope.ts';
import { hostingAuditHostKindsForSystems, inferContentType, summarizePostDeployHostingAudit } from './tenant-cloudflare-deploy-context.ts';

export async function repairHostingAfterSuccessfulDeploy(options: ProjectPlatformActionOptions, systems: TreeseedRunnableBootstrapSystem[]) {
	if (options.scope === 'local') {
		return {
			ok: true,
			skipped: true,
			reason: 'local_environment',
		};
	}
	if (options.planOnly) {
		return {
			ok: true,
			skipped: true,
			reason: 'plan',
		};
	}
	if (process.env.TREESEED_POST_DEPLOY_HOSTING_REPAIR === 'off') {
		return {
			ok: true,
			skipped: true,
			reason: 'disabled',
		};
	}
	const hostKinds = hostingAuditHostKindsForSystems(systems);
	if (hostKinds.length === 0) {
		return {
			ok: true,
			skipped: true,
			reason: 'no_host_kinds',
		};
	}
	const environment = options.scope === 'prod' ? 'prod' : 'staging';
	const env = { ...process.env, ...(options.env ?? {}) };
	const audit = await runTreeseedHostingAudit({
		tenantRoot: options.tenantRoot,
		environment,
		repair: false,
		env,
		hostKinds: [...hostKinds],
	});
	if (audit.ok) {
		return summarizePostDeployHostingAudit(audit, 'already_ready');
	}
	options.write?.(`[${environment}][hosting][repair] Hosting readiness needs repair after deploy for ${hostKinds.join(', ')}.`);
	const repaired = await runTreeseedHostingAudit({
		tenantRoot: options.tenantRoot,
		environment,
		repair: true,
		env,
		hostKinds: [...hostKinds],
		write: (line) => options.write?.(`[${environment}][hosting][repair] ${line}`),
	});
	const summary = summarizePostDeployHostingAudit(repaired, 'repaired');
	if (!summary.ok) {
		throw new Error(`Post-deploy hosting repair failed: ${summary.blockers[0] ?? `${summary.failedChecks} failed hosting readiness checks remain.`}`);
	}
	return summary;
}

export function resolveReporter(tenantRoot: string, explicit: ControlPlaneReporter | undefined) {
	if (explicit) {
		return explicit;
	}
	const deployConfig = loadCliDeployConfig(tenantRoot);
	return createControlPlaneReporter({ deployConfig });
}

export async function uploadObject(
	tenantRoot: string,
	wranglerPath: string,
	wranglerEnv: Record<string, string | undefined>,
	bucketName: string,
	pointer: PublishedContentObjectPointer,
	filePath: string,
	options: {
		write?: TreeseedBootstrapWriter;
		prefix: TreeseedBootstrapTaskPrefix;
	},
) {
	await runPrefixedWranglerWithRetry(tenantRoot, [
		'r2',
		'object',
		'put',
		`${bucketName}/${pointer.objectKey}`,
		'--config',
		wranglerPath,
		'--remote',
		'--force',
		'--file',
		filePath,
		'--content-type',
		pointer.contentType ?? inferContentType(filePath),
	], {
		env: wranglerEnv,
		write: options.write,
		prefix: options.prefix,
	});
}

export function deleteObject(
	tenantRoot: string,
	wranglerPath: string,
	wranglerEnv: Record<string, string | undefined>,
	bucketName: string,
	objectKey: string,
) {
	runWrangler(tenantRoot, [
		'r2',
		'object',
		'delete',
		`${bucketName}/${objectKey}`,
		'--config',
		wranglerPath,
		'--remote',
	], wranglerEnv, { allowFailure: true });
}

export function objectFileName(pointer: PublishedContentObjectPointer) {
	const ext = extname(pointer.objectKey) || '.json';
	return `${pointer.sha256}${ext}`;
}

export function canonicalSitePathForEntry(entry: { model: string; slug: string; id?: string }) {
	return entry.model === 'pages'
		? `/${entry.slug || entry.id || ''}`.replace(/\/+$/u, '') || '/'
		: `/${entry.model}/${entry.slug || entry.id || ''}`.replace(/\/+$/u, '');
}

export function contentIndexPathForModel(model: string) {
	return model === 'pages' ? null : `/${model}`;
}

export function sourceLikeFreshnessPaths() {
	return ['/', '/feed.xml', '/sitemap-index.xml'];
}

export function entrySignature(entry: Record<string, unknown>) {
	const { publishedAt, ...rest } = entry;
	return stableHash(JSON.stringify(rest));
}

export function artifactSignature(artifact: Record<string, unknown>) {
	const { publishedAt, ...rest } = artifact;
	return stableHash(JSON.stringify(rest));
}

export function canonicalEntryPath(entry: { model: string; slug: string; id?: string }) {
	return `${entry.model}/${entry.slug || entry.id || ''}`.replace(/^\/+|\/+$/gu, '');
}

export function changedEntries(previousManifest: PublishedContentManifest | null, nextEntries: Array<Record<string, unknown>>) {
	const previous = new Map((previousManifest?.entries ?? []).map((entry) => [canonicalEntryPath(entry), entrySignature(entry)]));
	return nextEntries.filter((entry) => previous.get(canonicalEntryPath(entry as { model: string; slug: string; id?: string })) !== entrySignature(entry));
}

export function changedArtifacts(previousManifest: PublishedContentManifest | null, nextArtifacts: Array<Record<string, unknown>>) {
	const previous = new Map((previousManifest?.artifacts ?? []).map((artifact) => [`${artifact.kind}:${artifact.itemId}`, artifactSignature(artifact)]));
	return nextArtifacts.filter((artifact) => previous.get(`${artifact.kind}:${artifact.itemId}`) !== artifactSignature(artifact));
}

export function absoluteUrl(baseUrl: string | null | undefined, path: string) {
	if (!baseUrl) {
		return null;
	}
	try {
		return new URL(path.startsWith('/') ? path : `/${path}`, baseUrl).toString();
	} catch {
		return null;
	}
}

export function stableEntryAliasKey(teamId: string, entry: { model: string; slug: string; id?: string; content: { objectKey: string } }) {
	const ext = extname(entry.content.objectKey) || '.md';
	return `teams/${teamId}/published/entries/${entry.model}/${entry.slug || entry.id}${ext}`;
}

export function stableArtifactAliasKey(teamId: string, artifact: { kind: string; itemId: string; content: { objectKey: string }; metadata?: Record<string, unknown> }) {
	const fileName = typeof artifact.metadata?.fileName === 'string' && artifact.metadata.fileName
		? artifact.metadata.fileName
		: `${artifact.itemId}${extname(artifact.content.objectKey) || '.bin'}`;
	return `teams/${teamId}/published/artifacts/${artifact.kind}/${artifact.itemId}/${fileName}`;
}

export async function probeHttp(url: string, { attempts = 1, delayMs = 2000 }: { attempts?: number; delayMs?: number } = {}) {
	let result: { ok: boolean; status: number | null; url: string; error?: string; attempts?: number } = {
		ok: false,
		status: null,
		url,
	};
	const maxAttempts = Math.max(1, Math.floor(attempts));
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			const response = await fetch(url, {
				headers: { accept: 'application/json,text/html;q=0.9,*/*;q=0.8' },
			});
			result = {
				ok: response.ok,
				status: response.status,
				url,
				attempts: attempt,
			};
		} catch (error) {
			result = {
				ok: false,
				status: null,
				url,
				error: error instanceof Error ? error.message : String(error),
				attempts: attempt,
			};
		}
		if (result.ok || attempt >= maxAttempts) {
			return result;
		}
		await sleep(delayMs);
	}
	return result;
}

export function findFirstMatchingString(value, matcher, seen = new Set()) {
	if (typeof value === 'string') {
		return matcher(value) ? value : null;
	}
	if (!value || typeof value !== 'object') {
		return null;
	}
	if (seen.has(value)) {
		return null;
	}
	seen.add(value);
	if (Array.isArray(value)) {
		for (const entry of value) {
			const match = findFirstMatchingString(entry, matcher, seen);
			if (match) {
				return match;
			}
		}
		return null;
	}
	for (const entry of Object.values(value)) {
		const match = findFirstMatchingString(entry, matcher, seen);
		if (match) {
			return match;
		}
	}
	return null;
}

export function resolveImmediatePagesProbeUrl(siteConfig, state, target) {
	if (target.kind === 'persistent' && target.scope === 'prod' && state.pages?.projectName) {
		return `https://${state.pages.projectName}.pages.dev`;
	}
	const configuredUrl = resolveConfiguredSurfaceBaseUrl(siteConfig, target, 'web');
	if (configuredUrl) {
		return configuredUrl;
	}
	if (target.kind === 'persistent' && target.scope === 'staging' && state.pages?.projectName) {
		return `https://${state.pages?.stagingBranch ?? 'staging'}.${state.pages.projectName}.pages.dev`;
	}
	return state.pages?.url ?? siteConfig.siteUrl;
}
