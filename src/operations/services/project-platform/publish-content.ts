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
import { ProjectPlatformActionOptions, ProjectPlatformContentPublishMode, currentCommit, currentRef, runTenantPublishContentPreflight, sanitizeSegment, stableHash } from './project-platform-scope.ts';
import { projectPlatformTempRoot, readR2JsonObject, reportDeployment, toBuffer, writeTempFile } from './tenant-cloudflare-deploy-context.ts';
import { absoluteUrl, canonicalSitePathForEntry, changedArtifacts, changedEntries, contentIndexPathForModel, deleteObject, objectFileName, sourceLikeFreshnessPaths, stableArtifactAliasKey, stableEntryAliasKey, uploadObject } from './repair-hosting-after-successful-deploy.ts';

export async function publishContent(
	options: ProjectPlatformActionOptions,
	reporter: ControlPlaneReporter,
	publishOptions: { mode?: ProjectPlatformContentPublishMode } = {},
) {
	const target = runTenantPublishContentPreflight(options);
	const siteConfig = loadCliDeployConfig(options.tenantRoot);
	const tenantConfig = loadTreeseedManifest(resolve(options.tenantRoot, 'src', 'manifest.yaml'));
	const teamId = resolveTreeseedResourceIdentity(siteConfig, target).teamId;
	const timestamp = new Date().toISOString();
	const commitSha = currentCommit(options.tenantRoot);
	const branchName = currentRef(options.tenantRoot);
	const previewId = options.previewId
		?? `staging-${sanitizeSegment(branchName, 'preview')}-${sanitizeSegment(commitSha?.slice(0, 12), 'latest')}`;
	const locator = resolveTeamScopedContentLocator(siteConfig, teamId);
	const { wranglerPath } = ensureGeneratedWranglerConfig(options.tenantRoot, { target });
	const wranglerEnv = { CLOUDFLARE_ACCOUNT_ID: String(process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? siteConfig.cloudflare.accountId ?? '').trim() };
	const bucketName = String(process.env.TREESEED_CONTENT_BUCKET_NAME ?? siteConfig.cloudflare.r2?.bucketName ?? '').trim();
	if (!bucketName) {
		throw new Error('Treeseed content publish requires TREESEED_CONTENT_BUCKET_NAME to be configured.');
	}

	const previousManifest = readR2JsonObject(
		options.tenantRoot,
		bucketName,
		locator.manifestKey,
		wranglerPath,
		wranglerEnv,
	) as PublishedContentManifest | null;

	const pipeline = createPublishedContentPipeline({
		projectRoot: options.tenantRoot,
		siteConfig,
		tenantConfig,
		teamId,
		generatedAt: timestamp,
		sourceCommit: commitSha,
		sourceRef: branchName,
		previewId,
	});

	const publishMode = publishOptions.mode ?? (options.scope === 'staging' ? 'editorial_overlay' : 'production');
	const built = publishMode === 'editorial_overlay'
		? await pipeline.buildEditorialOverlay({ previousManifest, previewId })
		: await pipeline.buildProductionRevision({ previousManifest });
	const changedEntrySet = 'manifest' in built ? changedEntries(previousManifest, built.manifest.entries) : [];
	const changedArtifactSet = 'manifest' in built ? changedArtifacts(previousManifest, built.manifest.artifacts ?? []) : [];
	const tombstones = 'manifest' in built ? (built.manifest.tombstones ?? []) : [];
	const objectByKey = new Map(built.objects.map((object) => [object.pointer.objectKey, object]));
	const publicObjectBaseUrl = process.env.TREESEED_CONTENT_PUBLIC_BASE_URL ?? siteConfig.cloudflare.r2?.publicBaseUrl ?? null;
	const stableObjectUploads: Array<{ pointer: PublishedContentObjectPointer; body: Buffer }> = [];
	const deletedObjectKeys: string[] = [];
	const contentPurgeUrls = new Set<string>();

	if ('manifest' in built && publicObjectBaseUrl) {
		for (const entry of built.manifest.entries) {
			entry.content.publicUrl = absoluteUrl(publicObjectBaseUrl, stableEntryAliasKey(teamId, entry)) ?? undefined;
		}
		for (const artifact of built.manifest.artifacts ?? []) {
			artifact.content.publicUrl = artifact.content.publicUrl
				?? absoluteUrl(publicObjectBaseUrl, stableArtifactAliasKey(teamId, artifact))
				?? undefined;
		}
		for (const entry of changedEntrySet) {
			const current = entry as PublishedContentManifest['entries'][number];
			const sourceObject = objectByKey.get(current.content.objectKey);
			const publicUrl = current.content.publicUrl ?? absoluteUrl(publicObjectBaseUrl, stableEntryAliasKey(teamId, current));
			if (sourceObject) {
				stableObjectUploads.push({
					pointer: {
						objectKey: stableEntryAliasKey(teamId, current),
						sha256: sourceObject.pointer.sha256,
						size: sourceObject.pointer.size,
						contentType: sourceObject.pointer.contentType,
						publicUrl: publicUrl ?? undefined,
					},
					body: toBuffer(sourceObject.body),
				});
			}
			if (publicUrl) {
				contentPurgeUrls.add(publicUrl);
			}
			contentPurgeUrls.add(absoluteUrl(siteConfig.siteUrl, canonicalSitePathForEntry(current)) ?? '');
			const indexPath = contentIndexPathForModel(current.model);
			if (indexPath) {
				contentPurgeUrls.add(absoluteUrl(siteConfig.siteUrl, indexPath) ?? '');
			}
		}
		for (const artifact of changedArtifactSet) {
			const current = artifact as NonNullable<PublishedContentManifest['artifacts']>[number];
			const sourceObject = objectByKey.get(current.content.objectKey);
			const publicUrl = current.content.publicUrl ?? absoluteUrl(publicObjectBaseUrl, stableArtifactAliasKey(teamId, current));
			if (sourceObject && publicUrl) {
				stableObjectUploads.push({
					pointer: {
						objectKey: stableArtifactAliasKey(teamId, current),
						sha256: sourceObject.pointer.sha256,
						size: sourceObject.pointer.size,
						contentType: sourceObject.pointer.contentType,
						publicUrl,
					},
					body: toBuffer(sourceObject.body),
				});
			}
			if (publicUrl) {
				contentPurgeUrls.add(publicUrl);
			}
		}
		for (const tombstone of tombstones) {
			const [model, ...slugParts] = String(tombstone.path ?? '').split('/');
			if (!model || slugParts.length === 0) {
				continue;
			}
			const slug = slugParts.join('/');
			const aliasKey = stableEntryAliasKey(teamId, { model, slug, content: { objectKey: `${slug}.md` } });
			deletedObjectKeys.push(aliasKey);
			contentPurgeUrls.add(absoluteUrl(publicObjectBaseUrl, aliasKey) ?? '');
			contentPurgeUrls.add(absoluteUrl(siteConfig.siteUrl, canonicalSitePathForEntry({ model, slug })) ?? '');
			const indexPath = contentIndexPathForModel(model);
			if (indexPath) {
				contentPurgeUrls.add(absoluteUrl(siteConfig.siteUrl, indexPath) ?? '');
			}
		}
		for (const freshnessPath of sourceLikeFreshnessPaths()) {
			contentPurgeUrls.add(absoluteUrl(siteConfig.siteUrl, freshnessPath) ?? '');
		}
	}

	const tempRoot = mkdtempSync(join(projectPlatformTempRoot(options.tenantRoot, 'content-publish'), 'treeseed-content-publish-'));
	try {
		if (!options.planOnly) {
			const uploadOptions = {
				write: options.write,
				prefix: {
					scope: options.scope,
					system: 'content',
					task: 'publish',
					stage: 'upload',
				},
			};
			for (const object of built.objects) {
				const filePath = writeTempFile(tempRoot, objectFileName(object.pointer), toBuffer(object.body));
				await uploadObject(options.tenantRoot, wranglerPath, wranglerEnv, bucketName, object.pointer, filePath, uploadOptions);
			}
			for (const alias of stableObjectUploads) {
				const filePath = writeTempFile(tempRoot, objectFileName(alias.pointer), alias.body);
				await uploadObject(options.tenantRoot, wranglerPath, wranglerEnv, bucketName, alias.pointer, filePath, uploadOptions);
			}
			for (const objectKey of deletedObjectKeys) {
				deleteObject(options.tenantRoot, wranglerPath, wranglerEnv, bucketName, objectKey);
			}

			if ('overlay' in built) {
				const overlayFile = writeTempFile(tempRoot, 'overlay.json', Buffer.from(JSON.stringify(built.overlay, null, 2)));
				await uploadObject(
					options.tenantRoot,
					wranglerPath,
					wranglerEnv,
					bucketName,
					{
						objectKey: built.overlay.locator?.overlayKey ?? `${locator.previewRoot}/${previewId}/overlay.json`,
						sha256: stableHash(readFileSync(overlayFile)),
						size: statSync(overlayFile).size,
						contentType: 'application/json',
					},
					overlayFile,
					uploadOptions,
				);
			} else {
				const manifestFile = writeTempFile(tempRoot, 'manifest.json', Buffer.from(JSON.stringify(built.manifest, null, 2)));
				const snapshotKey = locator.manifestKey.replace(/\/common\.json$/u, `/manifests/${built.manifest.revision}.json`);
				await uploadObject(options.tenantRoot, wranglerPath, wranglerEnv, bucketName, {
					objectKey: snapshotKey,
					sha256: stableHash(readFileSync(manifestFile)),
					size: statSync(manifestFile).size,
					contentType: 'application/json',
				}, manifestFile, uploadOptions);
				await uploadObject(options.tenantRoot, wranglerPath, wranglerEnv, bucketName, {
					objectKey: locator.manifestKey,
					sha256: stableHash(readFileSync(manifestFile)),
					size: statSync(manifestFile).size,
					contentType: 'application/json',
				}, manifestFile, uploadOptions);
				if (contentPurgeUrls.size > 0) {
					try {
						purgePublishedContentCaches(options.tenantRoot, [...contentPurgeUrls].filter(Boolean), { target, env });
					} catch {
						// The purge helper persists its own error state.
					}
				}
			}
		}

		const state = loadDeployState(options.tenantRoot, siteConfig, { target });
		if (!options.planOnly) {
			state.content.lastPublishedManifestRevision = 'overlay' in built ? built.overlay.previewId : built.manifest.revision;
			state.content.lastPublishedManifestSha256 = stableHash(
				JSON.stringify('overlay' in built ? built.overlay : built.manifest),
			);
			writeDeployState(options.tenantRoot, state, { target });
		}

		const previewToken = publishMode === 'editorial_overlay' && process.env.TREESEED_EDITORIAL_PREVIEW_SECRET
			? signEditorialPreviewToken({
				teamId,
				previewId,
				expiresAt: 'overlay' in built
					? (built.overlay.expiresAt ?? new Date(Date.now() + resolvePublishedContentPreviewTtlHours(siteConfig) * 60 * 60 * 1000).toISOString())
					: new Date(Date.now() + resolvePublishedContentPreviewTtlHours(siteConfig) * 60 * 60 * 1000).toISOString(),
			}, process.env.TREESEED_EDITORIAL_PREVIEW_SECRET)
			: null;
		const previewBaseUrl = state.pages?.url ?? siteConfig.siteUrl;
		const previewUrl = previewToken ? `${previewBaseUrl}?preview=${encodeURIComponent(previewToken)}` : null;

		await reportDeployment(reporter, {
			environment: options.scope,
			deploymentKind: 'content',
			status: 'success',
			sourceRef: branchName,
			commitSha,
			triggeredByType: 'project_runner',
			metadata: {
				mode: publishMode,
				revision: 'overlay' in built ? built.overlay.previewId : built.manifest.revision,
				previewId: publishMode === 'editorial_overlay' ? previewId : null,
				previewUrl,
				entries: ('overlay' in built ? built.overlay.entries : built.manifest.entries).length,
				artifacts: ('overlay' in built ? built.overlay.artifacts : built.manifest.artifacts)?.length ?? 0,
				catalog: built.catalog.length,
				cachePurgeCount: contentPurgeUrls.size,
			},
			finishedAt: new Date().toISOString(),
		});

		return {
			ok: true,
			scope: options.scope,
			mode: publishMode,
			revision: 'overlay' in built ? built.overlay.previewId : built.manifest.revision,
			previewId: publishMode === 'editorial_overlay' ? previewId : null,
			previewUrl,
			target: deployTargetLabel(target),
		};
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}
