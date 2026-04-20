import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import {
	createControlPlaneReporter,
	type ControlPlaneDeploymentReport,
	type ControlPlaneReporter,
} from '../../control-plane.ts';
import {
	resolvePublishedContentPreviewTtlHours,
	resolveTeamScopedContentLocator,
	signEditorialPreviewToken,
	type PublishedContentManifest,
	type PublishedContentObjectPointer,
} from '../../platform/published-content.ts';
import { createPublishedContentPipeline } from '../../platform/published-content-pipeline.ts';
import { loadTreeseedManifest } from '../../platform/tenant-config.ts';
import { applyTreeseedEnvironmentToProcess, syncTreeseedRailwayEnvironment } from './config-runtime.ts';
import {
	createPersistentDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	loadDeployState,
	purgePublishedContentCaches,
	provisionCloudflareResources,
	runRemoteD1Migrations,
	syncCloudflareSecrets,
	verifyProvisionedCloudflareResources,
	writeDeployState,
} from './deploy.ts';
import { currentManagedBranch, PRODUCTION_BRANCH, STAGING_BRANCH } from './git-workflow.ts';
import {
	configuredRailwayServices,
	deployRailwayService,
	ensureRailwayScheduledJobs,
	validateRailwayDeployPrerequisites,
	validateRailwayServiceConfiguration,
	verifyRailwayScheduledJobs,
} from './railway-deploy.ts';
import { loadCliDeployConfig, packageScriptPath, resolveWranglerBin } from './runtime-tools.ts';
import { CloudflareQueuePullClient, CloudflareQueuePushClient } from '../../remote.ts';

export type ProjectPlatformScope = 'local' | 'staging' | 'prod';
export type ProjectPlatformAction = 'provision' | 'deploy_code' | 'publish_content' | 'monitor';

export interface ProjectPlatformActionOptions {
	tenantRoot: string;
	scope: ProjectPlatformScope;
	projectId?: string | null;
	previewId?: string | null;
	dryRun?: boolean;
	reporter?: ControlPlaneReporter;
}

function stableHash(value: Buffer | string) {
	return createHash('sha256').update(value).digest('hex');
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

function currentCommit(tenantRoot: string) {
	const result = spawnSync('git', ['rev-parse', 'HEAD'], {
		cwd: tenantRoot,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

function currentRef(tenantRoot: string) {
	const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
		cwd: tenantRoot,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

function sanitizeSegment(value: string | null | undefined, fallback: string) {
	const normalized = String(value ?? '')
		.trim()
		.replaceAll(/[\\/]+/g, '-')
		.replaceAll(/[^a-zA-Z0-9._-]+/g, '-')
		.replaceAll(/-+/g, '-')
		.replaceAll(/^-|-$/g, '');
	return normalized || fallback;
}

function runNodeScript(tenantRoot: string, scriptName: string, scriptArgs: string[] = []) {
	const result = spawnSync(process.execPath, [packageScriptPath(scriptName), ...scriptArgs], {
		cwd: tenantRoot,
		stdio: 'inherit',
		env: { ...process.env },
	});
	if (result.status !== 0) {
		throw new Error(`${scriptName} failed.`);
	}
}

function runWrangler(
	tenantRoot: string,
	args: string[],
	extraEnv: Record<string, string | undefined> = {},
	options: { capture?: boolean; allowFailure?: boolean } = {},
) {
	const result = spawnSync(process.execPath, [resolveWranglerBin(), ...args], {
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

function inferContentType(filePath: string) {
	const extension = extname(filePath).toLowerCase();
	if (extension === '.json') return 'application/json';
	if (extension === '.md') return 'text/markdown; charset=utf-8';
	if (extension === '.mdx') return 'text/mdx; charset=utf-8';
	return 'application/octet-stream';
}

function writeTempFile(root: string, name: string, body: Buffer | string) {
	const filePath = resolve(root, name);
	writeFileSync(filePath, body);
	return filePath;
}

function toBuffer(body: string | ArrayBuffer | ArrayBufferView) {
	if (typeof body === 'string') {
		return Buffer.from(body);
	}
	if (body instanceof ArrayBuffer) {
		return Buffer.from(body);
	}
	return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

function readR2JsonObject(
	tenantRoot: string,
	bucketName: string,
	objectKey: string,
	wranglerPath: string,
	wranglerEnv: Record<string, string | undefined>,
) {
	const tempRoot = mkdtempSync(join(tmpdir(), 'treeseed-r2-read-'));
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

function statSafe(filePath: string) {
	try {
		return statSync(filePath);
	} catch {
		return null;
	}
}

async function reportDeployment(
	reporter: ControlPlaneReporter,
	input: ControlPlaneDeploymentReport,
) {
	await reporter.reportDeployment(input);
}

function resolveReporter(tenantRoot: string, explicit: ControlPlaneReporter | undefined) {
	if (explicit) {
		return explicit;
	}
	const deployConfig = loadCliDeployConfig(tenantRoot);
	return createControlPlaneReporter({ deployConfig });
}

function uploadObject(
	tenantRoot: string,
	wranglerPath: string,
	wranglerEnv: Record<string, string | undefined>,
	bucketName: string,
	pointer: PublishedContentObjectPointer,
	filePath: string,
) {
	runWrangler(tenantRoot, [
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
	], wranglerEnv);
}

function deleteObject(
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

function objectFileName(pointer: PublishedContentObjectPointer) {
	const ext = extname(pointer.objectKey) || '.json';
	return `${pointer.sha256}${ext}`;
}

function canonicalSitePathForEntry(entry: { model: string; slug: string; id?: string }) {
	return entry.model === 'pages'
		? `/${entry.slug || entry.id || ''}`.replace(/\/+$/u, '') || '/'
		: `/${entry.model}/${entry.slug || entry.id || ''}`.replace(/\/+$/u, '');
}

function contentIndexPathForModel(model: string) {
	return model === 'pages' ? null : `/${model}`;
}

function sourceLikeFreshnessPaths() {
	return ['/', '/feed.xml', '/sitemap-index.xml'];
}

function entrySignature(entry: Record<string, unknown>) {
	const { publishedAt, ...rest } = entry;
	return stableHash(JSON.stringify(rest));
}

function artifactSignature(artifact: Record<string, unknown>) {
	const { publishedAt, ...rest } = artifact;
	return stableHash(JSON.stringify(rest));
}

function canonicalEntryPath(entry: { model: string; slug: string; id?: string }) {
	return `${entry.model}/${entry.slug || entry.id || ''}`.replace(/^\/+|\/+$/gu, '');
}

function changedEntries(previousManifest: PublishedContentManifest | null, nextEntries: Array<Record<string, unknown>>) {
	const previous = new Map((previousManifest?.entries ?? []).map((entry) => [canonicalEntryPath(entry), entrySignature(entry)]));
	return nextEntries.filter((entry) => previous.get(canonicalEntryPath(entry as { model: string; slug: string; id?: string })) !== entrySignature(entry));
}

function changedArtifacts(previousManifest: PublishedContentManifest | null, nextArtifacts: Array<Record<string, unknown>>) {
	const previous = new Map((previousManifest?.artifacts ?? []).map((artifact) => [`${artifact.kind}:${artifact.itemId}`, artifactSignature(artifact)]));
	return nextArtifacts.filter((artifact) => previous.get(`${artifact.kind}:${artifact.itemId}`) !== artifactSignature(artifact));
}

function absoluteUrl(baseUrl: string | null | undefined, path: string) {
	if (!baseUrl) {
		return null;
	}
	try {
		return new URL(path.startsWith('/') ? path : `/${path}`, baseUrl).toString();
	} catch {
		return null;
	}
}

function stableEntryAliasKey(teamId: string, entry: { model: string; slug: string; id?: string; content: { objectKey: string } }) {
	const ext = extname(entry.content.objectKey) || '.md';
	return `teams/${teamId}/published/entries/${entry.model}/${entry.slug || entry.id}${ext}`;
}

function stableArtifactAliasKey(teamId: string, artifact: { kind: string; itemId: string; content: { objectKey: string }; metadata?: Record<string, unknown> }) {
	const fileName = typeof artifact.metadata?.fileName === 'string' && artifact.metadata.fileName
		? artifact.metadata.fileName
		: `${artifact.itemId}${extname(artifact.content.objectKey) || '.bin'}`;
	return `teams/${teamId}/published/artifacts/${artifact.kind}/${artifact.itemId}/${fileName}`;
}

async function probeHttp(url: string) {
	try {
		const response = await fetch(url, {
			headers: { accept: 'application/json,text/html;q=0.9,*/*;q=0.8' },
		});
		return {
			ok: response.ok,
			status: response.status,
			url,
		};
	} catch (error) {
		return {
			ok: false,
			status: null,
			url,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function queueClientConfig(siteConfig, state) {
	const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID ?? siteConfig.cloudflare.accountId ?? '').trim();
	const queueId = state.queues?.agentWork?.queueId;
	const token = process.env.TREESEED_QUEUE_PUSH_TOKEN?.trim()
		|| process.env.TREESEED_QUEUE_PULL_TOKEN?.trim()
		|| process.env.CLOUDFLARE_API_TOKEN?.trim()
		|| '';
	if (!accountId || !queueId || !token) {
		return null;
	}
	return {
		accountId,
		queueId,
		token,
		apiBaseUrl: process.env.TREESEED_QUEUE_API_BASE_URL?.trim() || undefined,
	};
}

async function probeQueue(siteConfig, state) {
	const config = queueClientConfig(siteConfig, state);
	if (!config) {
		return { ok: false, skipped: true, reason: 'queue_probe_unconfigured' };
	}

	const pushClient = new CloudflareQueuePushClient(config);
	const pullClient = new CloudflareQueuePullClient(config);
	const messageId = `health-${Date.now()}`;
	await pushClient.enqueue({
		message: {
			messageId,
			taskId: messageId,
			workDayId: 'health-check',
			agentId: 'health-check',
			taskType: 'health_check',
			idempotencyKey: messageId,
			payloadRef: 'health',
			graphVersion: null,
			budgetHint: 0,
		},
	});
	const pulled = await pullClient.pull({
		batchSize: 1,
		visibilityTimeoutMs: 10000,
	});
	const message = pulled.messages.find((entry) => entry.body?.messageId === messageId) ?? pulled.messages[0] ?? null;
	if (!message) {
		return { ok: false, reason: 'queue_pull_empty' };
	}
	await pullClient.ack([message.leaseId]);
	return {
		ok: true,
		messageId,
		attempts: message.attempts,
	};
}

function r2HealthKey(state) {
	return `${state.content?.manifestKey?.replace(/\/common\.json$/u, '') ?? 'health'}/healthchecks/${Date.now()}.json`;
}

function deleteR2Object(
	tenantRoot: string,
	bucketName: string,
	objectKey: string,
	wranglerPath: string,
	wranglerEnv: Record<string, string | undefined>,
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

function probeR2(
	tenantRoot: string,
	siteConfig,
	state,
	target,
) {
	const bucketName = state.content?.bucketName;
	const cloudflareAccountId = String(process.env.CLOUDFLARE_ACCOUNT_ID ?? siteConfig.cloudflare.accountId ?? '').trim();
	if (!bucketName) {
		return { ok: false, skipped: true, reason: 'r2_unconfigured' };
	}
	const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	const wranglerEnv = { CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId };
	const tempRoot = mkdtempSync(join(tmpdir(), 'treeseed-r2-health-'));
	const objectKey = r2HealthKey(state);
	try {
		const payload = JSON.stringify({ ok: true, createdAt: new Date().toISOString() });
		const writeFile = writeTempFile(tempRoot, 'probe.json', payload);
		runWrangler(tenantRoot, [
			'r2',
			'object',
			'put',
			`${bucketName}/${objectKey}`,
			'--config',
			wranglerPath,
			'--remote',
			'--force',
			'--file',
			writeFile,
			'--content-type',
			'application/json',
		], wranglerEnv);
		const readBack = readR2JsonObject(tenantRoot, bucketName, objectKey, wranglerPath, wranglerEnv);
		return {
			ok: Boolean(readBack?.ok),
			objectKey,
		};
	} finally {
		deleteR2Object(tenantRoot, bucketName, objectKey, wranglerPath, wranglerEnv);
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

function probeScaleConfiguration(siteConfig, state) {
	const worker = state.services?.worker ?? {};
	const scalerKind = String(process.env.TREESEED_WORKER_POOL_SCALER ?? '').trim();
	return {
		ok: Boolean(
			(scalerKind === 'railway' || siteConfig.services?.worker?.provider === 'railway')
			&& (worker.serviceId || process.env.TREESEED_RAILWAY_WORKER_SERVICE_ID)
			&& (process.env.TREESEED_RAILWAY_ENVIRONMENT_ID || process.env.TREESEED_RAILWAY_PROJECT_ID || worker.projectId),
		),
		mocked: true,
		serviceId: worker.serviceId ?? null,
	};
}

async function publishContent(
	options: ProjectPlatformActionOptions,
	reporter: ControlPlaneReporter,
) {
	const siteConfig = loadCliDeployConfig(options.tenantRoot);
	const tenantConfig = loadTreeseedManifest(resolve(options.tenantRoot, 'src', 'manifest.yaml'));
	const teamId = String(process.env.TREESEED_HOSTING_TEAM_ID ?? siteConfig.hosting?.teamId ?? siteConfig.slug).trim() || siteConfig.slug;
	const timestamp = new Date().toISOString();
	const commitSha = currentCommit(options.tenantRoot);
	const branchName = currentRef(options.tenantRoot);
	const previewId = options.previewId
		?? `staging-${sanitizeSegment(branchName, 'preview')}-${sanitizeSegment(commitSha?.slice(0, 12), 'latest')}`;
	const locator = resolveTeamScopedContentLocator(siteConfig, teamId);
	const target = createPersistentDeployTarget(options.scope === 'local' ? 'staging' : options.scope);
	const { wranglerPath } = ensureGeneratedWranglerConfig(options.tenantRoot, { target });
	const wranglerEnv = { CLOUDFLARE_ACCOUNT_ID: String(process.env.CLOUDFLARE_ACCOUNT_ID ?? siteConfig.cloudflare.accountId ?? '').trim() };
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

	const built = options.scope === 'staging'
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

	const tempRoot = mkdtempSync(join(tmpdir(), 'treeseed-content-publish-'));
	try {
		if (!options.dryRun) {
			for (const object of built.objects) {
				const filePath = writeTempFile(tempRoot, objectFileName(object.pointer), toBuffer(object.body));
				uploadObject(options.tenantRoot, wranglerPath, wranglerEnv, bucketName, object.pointer, filePath);
			}
			for (const alias of stableObjectUploads) {
				const filePath = writeTempFile(tempRoot, objectFileName(alias.pointer), alias.body);
				uploadObject(options.tenantRoot, wranglerPath, wranglerEnv, bucketName, alias.pointer, filePath);
			}
			for (const objectKey of deletedObjectKeys) {
				deleteObject(options.tenantRoot, wranglerPath, wranglerEnv, bucketName, objectKey);
			}

			if ('overlay' in built) {
				const overlayFile = writeTempFile(tempRoot, 'overlay.json', Buffer.from(JSON.stringify(built.overlay, null, 2)));
				uploadObject(
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
				);
			} else {
				const manifestFile = writeTempFile(tempRoot, 'manifest.json', Buffer.from(JSON.stringify(built.manifest, null, 2)));
				const snapshotKey = locator.manifestKey.replace(/\/common\.json$/u, `/manifests/${built.manifest.revision}.json`);
				uploadObject(options.tenantRoot, wranglerPath, wranglerEnv, bucketName, {
					objectKey: snapshotKey,
					sha256: stableHash(readFileSync(manifestFile)),
					size: statSync(manifestFile).size,
					contentType: 'application/json',
				}, manifestFile);
				uploadObject(options.tenantRoot, wranglerPath, wranglerEnv, bucketName, {
					objectKey: locator.manifestKey,
					sha256: stableHash(readFileSync(manifestFile)),
					size: statSync(manifestFile).size,
					contentType: 'application/json',
				}, manifestFile);
				if (contentPurgeUrls.size > 0) {
					try {
						purgePublishedContentCaches(options.tenantRoot, [...contentPurgeUrls].filter(Boolean), { target });
					} catch {
						// The purge helper persists its own error state.
					}
				}
			}
		}

		const state = loadDeployState(options.tenantRoot, siteConfig, { target });
		state.content.lastPublishedManifestRevision = 'overlay' in built ? built.overlay.previewId : built.manifest.revision;
		state.content.lastPublishedManifestSha256 = stableHash(
			JSON.stringify('overlay' in built ? built.overlay : built.manifest),
		);
		writeDeployState(options.tenantRoot, state, { target });

		const previewToken = options.scope === 'staging' && process.env.TREESEED_EDITORIAL_PREVIEW_SECRET
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
				mode: options.scope === 'staging' ? 'editorial_overlay' : 'production',
				revision: 'overlay' in built ? built.overlay.previewId : built.manifest.revision,
				previewId: options.scope === 'staging' ? previewId : null,
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
			mode: options.scope === 'staging' ? 'editorial_overlay' : 'production',
			revision: 'overlay' in built ? built.overlay.previewId : built.manifest.revision,
			previewId: options.scope === 'staging' ? previewId : null,
			previewUrl,
			target: deployTargetLabel(target),
		};
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

export async function provisionProjectPlatform(options: ProjectPlatformActionOptions) {
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	const target = createPersistentDeployTarget(options.scope === 'local' ? 'staging' : options.scope);
	const siteConfig = loadCliDeployConfig(options.tenantRoot);
	const summary = provisionCloudflareResources(options.tenantRoot, { dryRun: options.dryRun, target });
	const verification = verifyProvisionedCloudflareResources(options.tenantRoot, { dryRun: options.dryRun, target });
	ensureGeneratedWranglerConfig(options.tenantRoot, { target });
	const syncedSecrets = syncCloudflareSecrets(options.tenantRoot, { dryRun: options.dryRun, target });
	const syncedRailway = options.scope === 'local' ? [] : syncTreeseedRailwayEnvironment({ tenantRoot: options.tenantRoot, scope: options.scope, dryRun: options.dryRun });
	const railwayValidation = options.scope === 'local'
		? validateRailwayServiceConfiguration(options.tenantRoot, options.scope)
		: validateRailwayDeployPrerequisites(options.tenantRoot, options.scope);
	const railwaySchedules = options.scope === 'local'
		? []
		: await ensureRailwayScheduledJobs(options.tenantRoot, options.scope, { dryRun: options.dryRun });
	const railwayScheduleVerification = options.scope === 'local' || options.dryRun
		? { ok: true, checks: railwaySchedules }
		: await verifyRailwayScheduledJobs(options.tenantRoot, options.scope);
	const state = loadDeployState(options.tenantRoot, siteConfig, { target });

	await reporter.reportEnvironment({
		environment: options.scope,
		deploymentProfile: siteConfig.hosting?.kind ?? 'self_hosted_project',
		baseUrl: state.lastDeployedUrl,
		cloudflareAccountId: String(process.env.CLOUDFLARE_ACCOUNT_ID ?? siteConfig.cloudflare.accountId ?? '').trim() || null,
		pagesProjectName: state.pages?.projectName ?? null,
		workerName: state.workerName,
		r2BucketName: state.content?.bucketName ?? null,
		d1DatabaseName: state.d1Databases?.SITE_DATA_DB?.databaseName ?? null,
		queueName: state.queues?.agentWork?.name ?? null,
		railwayProjectName: railwayValidation.services[0]?.projectName ?? null,
		metadata: {
			target: deployTargetLabel(target),
			previewEnabled: state.previewEnabled ?? false,
			readiness: state.readiness,
		},
	});

	const resourceReports = [
		{
			environment: options.scope,
			provider: 'cloudflare' as const,
			resourceKind: 'pages' as const,
			logicalName: state.pages?.projectName ?? 'pages',
			locator: state.pages?.url ?? null,
			metadata: state.pages ?? {},
		},
		{
			environment: options.scope,
			provider: 'cloudflare' as const,
			resourceKind: 'worker' as const,
			logicalName: state.workerName,
			locator: state.lastDeployedUrl ?? null,
			metadata: { workerName: state.workerName },
		},
		{
			environment: options.scope,
			provider: 'cloudflare' as const,
			resourceKind: 'r2' as const,
			logicalName: state.content?.bucketName ?? 'content',
			locator: state.content?.manifestKey ?? null,
			metadata: state.content ?? {},
		},
		{
			environment: options.scope,
			provider: 'cloudflare' as const,
			resourceKind: 'd1' as const,
			logicalName: state.d1Databases?.SITE_DATA_DB?.databaseName ?? 'site-data',
			locator: state.d1Databases?.SITE_DATA_DB?.databaseId ?? null,
			metadata: state.d1Databases?.SITE_DATA_DB ?? {},
		},
		{
			environment: options.scope,
			provider: 'cloudflare' as const,
			resourceKind: 'queue' as const,
			logicalName: state.queues?.agentWork?.name ?? 'agent-work',
			locator: state.queues?.agentWork?.binding ?? null,
			metadata: state.queues?.agentWork ?? {},
		},
	];

	for (const resource of resourceReports) {
		await reporter.reportResource(resource);
	}
	for (const service of railwayValidation.services) {
		await reporter.reportResource({
			environment: options.scope,
			provider: 'railway',
			resourceKind: service.serviceId ? 'railway_service' : 'railway_project',
			logicalName: service.key,
			locator: service.serviceName ?? service.serviceId ?? service.projectName ?? service.projectId ?? null,
			metadata: service,
		});
	}
	for (const schedule of railwaySchedules) {
		const serviceState = state.services?.[schedule.service];
		if (serviceState) {
			serviceState.lastScheduleSyncAt = new Date().toISOString();
		}
		state.railwaySchedules[schedule.logicalName] = {
			...(state.railwaySchedules[schedule.logicalName] ?? {}),
			...schedule,
			lastSyncedAt: new Date().toISOString(),
		};
		await reporter.reportResource({
			environment: options.scope,
			provider: 'railway',
			resourceKind: 'railway_schedule',
			logicalName: schedule.logicalName,
			locator: schedule.id ?? schedule.expression,
			metadata: schedule,
		});
	}
	writeDeployState(options.tenantRoot, state, { target });

	await reportDeployment(reporter, {
		environment: options.scope,
		deploymentKind: 'provision',
		status: 'success',
		sourceRef: currentRef(options.tenantRoot),
		commitSha: currentCommit(options.tenantRoot),
		triggeredByType: 'project_runner',
		metadata: {
			target: deployTargetLabel(target),
			summary,
			verification,
			syncedSecrets,
			syncedRailway,
			railwayServices: railwayValidation.services.map((service) => service.key),
			railwaySchedules,
			railwayScheduleVerification,
		},
		finishedAt: new Date().toISOString(),
	});

	return {
		ok: true,
		scope: options.scope,
		target: deployTargetLabel(target),
		summary,
		verification,
		railway: {
			services: railwayValidation.services.map((service) => service.key),
			schedules: railwaySchedules,
			verification: railwayScheduleVerification,
		},
	};
}

export async function deployProjectPlatform(options: ProjectPlatformActionOptions) {
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	const commitSha = currentCommit(options.tenantRoot);
	const branchName = currentRef(options.tenantRoot);
	await reportDeployment(reporter, {
		environment: options.scope,
		deploymentKind: 'code',
		status: 'running',
		sourceRef: branchName,
		commitSha,
		triggeredByType: 'project_runner',
		metadata: { scope: options.scope },
	});

	await provisionProjectPlatform({ ...options, reporter });
	runNodeScript(options.tenantRoot, 'tenant-deploy', ['--environment', options.scope, ...(options.dryRun ? ['--dry-run'] : [])]);

	const serviceResults = [];
	if (options.scope !== 'local') {
		const validation = validateRailwayDeployPrerequisites(options.tenantRoot, options.scope);
		for (const service of validation.services) {
			serviceResults.push(deployRailwayService(options.tenantRoot, service, { dryRun: options.dryRun }));
		}
		finalizeDeploymentState(options.tenantRoot, {
			target: createPersistentDeployTarget(options.scope),
			serviceResults,
		});
	}
	const monitor = await monitorProjectPlatform({ ...options, reporter });

	await reportDeployment(reporter, {
		environment: options.scope,
		deploymentKind: 'code',
		status: 'success',
		sourceRef: branchName,
		commitSha,
		triggeredByType: 'project_runner',
		metadata: {
			scope: options.scope,
			railway: options.scope === 'local' ? [] : configuredRailwayServices(options.tenantRoot, options.scope).map((service) => service.key),
			monitor,
		},
		finishedAt: new Date().toISOString(),
	});

	return {
		ok: true,
		scope: options.scope,
		monitor,
		serviceResults,
	};
}

export async function publishProjectContent(options: ProjectPlatformActionOptions) {
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	return publishContent(options, reporter);
}

export async function monitorProjectPlatform(options: ProjectPlatformActionOptions) {
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	const target = createPersistentDeployTarget(options.scope === 'local' ? 'staging' : options.scope);
	const siteConfig = loadCliDeployConfig(options.tenantRoot);
	const state = loadDeployState(options.tenantRoot, siteConfig, { target });
	const apiBaseUrl = siteConfig.services?.api?.environments?.[options.scope]?.baseUrl
		?? siteConfig.services?.api?.publicBaseUrl
		?? process.env.TREESEED_API_BASE_URL
		?? state.services?.api?.lastDeployedUrl
		?? null;
	const checks = {
		pages: await probeHttp(state.pages?.url ?? siteConfig.siteUrl),
		apiHealth: apiBaseUrl ? await probeHttp(`${String(apiBaseUrl).replace(/\/+$/u, '')}/healthz`) : { ok: false, skipped: true, reason: 'api_url_unconfigured' },
		apiReady: apiBaseUrl ? await probeHttp(`${String(apiBaseUrl).replace(/\/+$/u, '')}/readyz`) : { ok: false, skipped: true, reason: 'api_url_unconfigured' },
		d1Health: apiBaseUrl ? await probeHttp(`${String(apiBaseUrl).replace(/\/+$/u, '')}/healthz/deep`) : { ok: false, skipped: true, reason: 'api_url_unconfigured' },
		agentHealth: apiBaseUrl ? await probeHttp(`${String(apiBaseUrl).replace(/\/+$/u, '')}/agent/healthz`) : { ok: false, skipped: true, reason: 'api_url_unconfigured' },
		r2: options.dryRun ? { ok: true, skipped: true, reason: 'dry_run' } : probeR2(options.tenantRoot, siteConfig, state, target),
		queue: options.dryRun ? Promise.resolve({ ok: true, skipped: true, reason: 'dry_run' }) : probeQueue(siteConfig, state),
		scaleProbe: probeScaleConfiguration(siteConfig, state),
		readiness: state.readiness,
	};
	const resolvedChecks = {
		...checks,
		r2: await checks.r2,
		queue: await checks.queue,
	};
	const ok = [
		resolvedChecks.pages,
		resolvedChecks.apiHealth,
		resolvedChecks.apiReady,
		resolvedChecks.d1Health,
		resolvedChecks.agentHealth,
		resolvedChecks.r2,
		resolvedChecks.queue,
		resolvedChecks.scaleProbe,
	].every((check) => check?.ok === true || check?.skipped === true);
	if (!ok) {
		throw new Error(`Treeseed monitor failed for ${options.scope}.`);
	}
	await reportDeployment(reporter, {
		environment: options.scope,
		deploymentKind: 'mixed',
		status: 'success',
		sourceRef: currentRef(options.tenantRoot),
		commitSha: currentCommit(options.tenantRoot),
		triggeredByType: 'project_runner',
		metadata: {
			mode: 'monitor',
			target: deployTargetLabel(target),
			checks: resolvedChecks,
		},
		finishedAt: new Date().toISOString(),
	});
	return {
		ok,
		target: deployTargetLabel(target),
		checks: resolvedChecks,
	};
}

export async function syncControlPlaneState(options: ProjectPlatformActionOptions) {
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	const target = createPersistentDeployTarget(options.scope === 'local' ? 'staging' : options.scope);
	const siteConfig = loadCliDeployConfig(options.tenantRoot);
	const state = loadDeployState(options.tenantRoot, siteConfig, { target });
	await reporter.reportEnvironment({
		environment: options.scope,
		deploymentProfile: siteConfig.hosting?.kind ?? 'self_hosted_project',
		baseUrl: state.lastDeployedUrl,
		cloudflareAccountId: String(process.env.CLOUDFLARE_ACCOUNT_ID ?? siteConfig.cloudflare.accountId ?? '').trim() || null,
		pagesProjectName: state.pages?.projectName ?? null,
		workerName: state.workerName,
		r2BucketName: state.content?.bucketName ?? null,
		d1DatabaseName: state.d1Databases?.SITE_DATA_DB?.databaseName ?? null,
		queueName: state.queues?.agentWork?.name ?? null,
		railwayProjectName: state.services.api?.provider === 'railway' ? state.services.api?.lastDeployedUrl ?? null : null,
		metadata: { target: deployTargetLabel(target) },
	});
}

export async function runProjectPlatformAction(action: ProjectPlatformAction, options: ProjectPlatformActionOptions) {
	applyTreeseedEnvironmentToProcess({ tenantRoot: options.tenantRoot, scope: options.scope, override: true });
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	try {
		switch (action) {
			case 'provision':
				return await provisionProjectPlatform({ ...options, reporter });
			case 'deploy_code':
				return await deployProjectPlatform({ ...options, reporter });
			case 'publish_content':
				return await publishProjectContent({ ...options, reporter });
			case 'monitor':
				return await monitorProjectPlatform({ ...options, reporter });
			default:
				throw new Error(`Unsupported workflow action "${action}".`);
		}
	} catch (error) {
		await reportDeployment(reporter, {
			environment: options.scope,
			deploymentKind: action === 'provision'
				? 'provision'
				: action === 'publish_content'
					? 'content'
					: action === 'deploy_code'
						? 'code'
						: 'mixed',
			status: 'failed',
			sourceRef: currentRef(options.tenantRoot),
			commitSha: currentCommit(options.tenantRoot),
			triggeredByType: 'project_runner',
			metadata: {
				message: error instanceof Error ? error.message : String(error),
			},
			finishedAt: new Date().toISOString(),
		}).catch(() => undefined);
		throw error;
	}
}
