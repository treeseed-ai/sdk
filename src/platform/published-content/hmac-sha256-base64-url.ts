import type { DeployConfig } from '../support/contracts.ts';
import type { CommerceOfferMode } from '../../entrypoints/models/sdk-types.ts';
import type { CloudflareRuntime, R2BucketLike } from '../../types/cloudflare.ts';
import { EditorialPreviewTokenPayload, HostedContentMode, PUBLISHED_CONTENT_MANIFEST_SCHEMA_VERSION, PublishedArtifactVersion, PublishedCollectionIndex, PublishedContentEntry, PublishedContentManifest, PublishedContentObjectPointer, PublishedContentVisibility, PublishedManifestTombstone, PublishedOverlayManifest, PublishedRuntimePointers, TeamScopedContentLocator, expectRecord, expectString, getNodeCrypto, isRecord, optionalNumber, optionalString } from './published-content-manifest-schema-version.ts';

export function hmacSha256Base64Url(value: string, secret: string) {
	const crypto = getNodeCrypto();
	if (!crypto?.createHmac) {
		throw new Error('Editorial preview token signing requires a crypto runtime.');
	}

	return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function base64UrlEncode(value: string) {
	return Buffer.from(value, 'utf8').toString('base64url');
}

export function base64UrlDecode(value: string) {
	return Buffer.from(value, 'base64url').toString('utf8');
}

export function canonicalEntryPath(entry: Pick<PublishedContentEntry, 'model' | 'slug' | 'id'>) {
	return `${entry.model}/${entry.slug || entry.id}`.replace(/^\/+|\/+$/g, '');
}

export function normalizeObjectPointer(value: unknown, label: string): PublishedContentObjectPointer {
	const record = expectRecord(value, label);
	return {
		objectKey: expectString(record.objectKey ?? record.key, `${label}.objectKey`),
		sha256: expectString(record.sha256, `${label}.sha256`),
		size: optionalNumber(record.size),
		contentType: optionalString(record.contentType),
		publicUrl: optionalString(record.publicUrl),
	};
}

export function normalizeRuntimePointers(value: unknown, label: string): PublishedRuntimePointers | undefined {
	const record = isRecord(value) ? value : undefined;
	if (!record) {
		return undefined;
	}

	return {
		docsHomePath: optionalString(record.docsHomePath),
		booksRuntime: record.booksRuntime ? normalizeObjectPointer(record.booksRuntime, `${label}.booksRuntime`) : undefined,
		docsTree: record.docsTree ? normalizeObjectPointer(record.docsTree, `${label}.docsTree`) : undefined,
		searchIndex: record.searchIndex ? normalizeObjectPointer(record.searchIndex, `${label}.searchIndex`) : undefined,
	};
}

export function normalizeLocator(value: unknown, label: string): TeamScopedContentLocator | undefined {
	const record = isRecord(value) ? value : undefined;
	if (!record) {
		return undefined;
	}

	return {
		teamId: expectString(record.teamId, `${label}.teamId`),
		manifestKey: expectString(record.manifestKey, `${label}.manifestKey`),
		previewRoot: expectString(record.previewRoot, `${label}.previewRoot`),
		overlayKey: optionalString(record.overlayKey),
		previewId: optionalString(record.previewId),
		mode: optionalString(record.mode) as HostedContentMode | undefined,
	};
}

export function normalizeContentEntry(value: unknown, label: string): PublishedContentEntry {
	const record = expectRecord(value, label);
	return {
		id: expectString(record.id, `${label}.id`),
		model: expectString(record.model, `${label}.model`),
		slug: expectString(record.slug, `${label}.slug`),
		title: optionalString(record.title),
		summary: optionalString(record.summary),
		status: optionalString(record.status),
		visibility: optionalString(record.visibility) as PublishedContentVisibility | undefined,
		teamId: optionalString(record.teamId),
		publishedAt: optionalString(record.publishedAt),
		updatedAt: optionalString(record.updatedAt),
		content: normalizeObjectPointer(record.content, `${label}.content`),
		rendered: record.rendered ? normalizeObjectPointer(record.rendered, `${label}.rendered`) : undefined,
		search: record.search ? normalizeObjectPointer(record.search, `${label}.search`) : undefined,
		metadata: isRecord(record.metadata) ? record.metadata : undefined,
	};
}

export function normalizeArtifactVersion(value: unknown, label: string): PublishedArtifactVersion {
	const record = expectRecord(value, label);
	return {
		id: expectString(record.id, `${label}.id`),
		itemId: expectString(record.itemId, `${label}.itemId`),
		kind: expectString(record.kind, `${label}.kind`),
		version: expectString(record.version, `${label}.version`),
		label: optionalString(record.label),
		visibility: optionalString(record.visibility) as PublishedContentVisibility | undefined,
		teamId: optionalString(record.teamId),
		publishedAt: expectString(record.publishedAt, `${label}.publishedAt`),
		content: normalizeObjectPointer(record.content, `${label}.content`),
		metadata: isRecord(record.metadata) ? record.metadata : undefined,
	};
}

export function normalizeTombstones(value: unknown): PublishedManifestTombstone[] {
	return Array.isArray(value)
		? value.map((item, index) => {
			const tombstone = expectRecord(item, `tombstones[${index}]`);
			return {
				path: expectString(tombstone.path, `tombstones[${index}].path`),
				removedAt: expectString(tombstone.removedAt, `tombstones[${index}].removedAt`),
				previousSha256: optionalString(tombstone.previousSha256),
			};
		})
		: [];
}

export function parsePublishedContentManifest(value: unknown): PublishedContentManifest {
	const record = expectRecord(value, 'manifest');
	const collectionsRecord = isRecord(record.collections) ? record.collections : {};

	return {
		schemaVersion: optionalNumber(record.schemaVersion) ?? PUBLISHED_CONTENT_MANIFEST_SCHEMA_VERSION,
		siteSlug: expectString(record.siteSlug, 'manifest.siteSlug'),
		teamId: optionalString(record.teamId) ?? expectString(record.siteSlug, 'manifest.siteSlug'),
		revision: expectString(record.revision, 'manifest.revision'),
		generatedAt: expectString(record.generatedAt, 'manifest.generatedAt'),
		mode: (optionalString(record.mode) as HostedContentMode | undefined) ?? 'production',
		sourceCommit: optionalString(record.sourceCommit),
		appRevision: optionalString(record.appRevision),
		appCompatibility: isRecord(record.appCompatibility)
			? {
				min: optionalString(record.appCompatibility.min),
				max: optionalString(record.appCompatibility.max),
				lastKnownCompatibleRevision: optionalString(record.appCompatibility.lastKnownCompatibleRevision),
			}
			: undefined,
		locator: normalizeLocator(record.locator, 'manifest.locator'),
		collections: Object.fromEntries(
			Object.entries(collectionsRecord).map(([model, pointer]) => [model, normalizeObjectPointer(pointer, `manifest.collections.${model}`)]),
		),
		entries: Array.isArray(record.entries)
			? record.entries.map((entry, index) => normalizeContentEntry(entry, `manifest.entries[${index}]`))
			: [],
		artifacts: Array.isArray(record.artifacts)
			? record.artifacts.map((artifact, index) => normalizeArtifactVersion(artifact, `manifest.artifacts[${index}]`))
			: [],
		runtime: normalizeRuntimePointers(record.runtime, 'manifest.runtime'),
		tombstones: normalizeTombstones(record.tombstones),
		metadata: isRecord(record.metadata) ? record.metadata : undefined,
	};
}

export function parsePublishedOverlayManifest(value: unknown): PublishedOverlayManifest {
	const record = expectRecord(value, 'overlay');
	const collectionsRecord = isRecord(record.collections) ? record.collections : {};
	return {
		schemaVersion: optionalNumber(record.schemaVersion) ?? PUBLISHED_CONTENT_MANIFEST_SCHEMA_VERSION,
		siteSlug: expectString(record.siteSlug, 'overlay.siteSlug'),
		teamId: optionalString(record.teamId) ?? expectString(record.siteSlug, 'overlay.siteSlug'),
		previewId: expectString(record.previewId, 'overlay.previewId'),
		generatedAt: expectString(record.generatedAt, 'overlay.generatedAt'),
		mode: (optionalString(record.mode) as HostedContentMode | undefined) ?? 'editorial_overlay',
		baseManifestKey: expectString(record.baseManifestKey, 'overlay.baseManifestKey'),
		baseRevision: optionalString(record.baseRevision),
		sourceCommit: optionalString(record.sourceCommit),
		expiresAt: optionalString(record.expiresAt),
		locator: normalizeLocator(record.locator, 'overlay.locator'),
		collections: Object.fromEntries(
			Object.entries(collectionsRecord).map(([model, pointer]) => [model, normalizeObjectPointer(pointer, `overlay.collections.${model}`)]),
		),
		entries: Array.isArray(record.entries)
			? record.entries.map((entry, index) => normalizeContentEntry(entry, `overlay.entries[${index}]`))
			: [],
		artifacts: Array.isArray(record.artifacts)
			? record.artifacts.map((artifact, index) => normalizeArtifactVersion(artifact, `overlay.artifacts[${index}]`))
			: [],
		runtime: normalizeRuntimePointers(record.runtime, 'overlay.runtime'),
		tombstones: normalizeTombstones(record.tombstones),
		metadata: isRecord(record.metadata) ? record.metadata : undefined,
	};
}

export function parsePublishedCollectionIndex(value: unknown): PublishedCollectionIndex {
	const record = expectRecord(value, 'collection index');
	return {
		model: expectString(record.model, 'collectionIndex.model'),
		generatedAt: expectString(record.generatedAt, 'collectionIndex.generatedAt'),
		count: optionalNumber(record.count),
		entries: Array.isArray(record.entries)
			? record.entries.map((entry, index) => normalizeContentEntry(entry, `collectionIndex.entries[${index}]`))
			: [],
	};
}

export function resolvePublishedContentBucketBinding(config: Pick<DeployConfig, 'cloudflare'>) {
	return config.cloudflare.r2?.binding ?? 'TREESEED_CONTENT_BUCKET';
}

export function fillTeamTemplate(template: string, teamId: string) {
	return template.replaceAll('{teamId}', teamId);
}

export function resolvePublishedContentManifestKey(
	config: Pick<DeployConfig, 'cloudflare'> & Partial<Pick<DeployConfig, 'slug'>>,
	teamId?: string,
) {
	const resolvedTeamId = typeof teamId === 'string' && teamId.trim()
		? teamId.trim()
		: (typeof config.slug === 'string' && config.slug.trim() ? config.slug.trim() : 'default');
	return fillTeamTemplate(
		config.cloudflare.r2?.manifestKeyTemplate ?? 'teams/{teamId}/published/common.json',
		resolvedTeamId,
	);
}

export function resolvePublishedContentPreviewRoot(
	config: Pick<DeployConfig, 'cloudflare'> & Partial<Pick<DeployConfig, 'slug'>>,
	teamId?: string,
) {
	const resolvedTeamId = typeof teamId === 'string' && teamId.trim()
		? teamId.trim()
		: (typeof config.slug === 'string' && config.slug.trim() ? config.slug.trim() : 'default');
	return fillTeamTemplate(
		config.cloudflare.r2?.previewRootTemplate ?? 'teams/{teamId}/previews',
		resolvedTeamId,
	);
}

export function resolvePublishedContentPreviewTtlHours(config: Pick<DeployConfig, 'cloudflare'>) {
	return config.cloudflare.r2?.previewTtlHours ?? 168;
}

export function resolveTeamScopedContentLocator(
	config: Pick<DeployConfig, 'cloudflare'>,
	teamId: string,
	previewId?: string,
): TeamScopedContentLocator {
	const previewRoot = resolvePublishedContentPreviewRoot(config, teamId);
	return {
		teamId,
		manifestKey: resolvePublishedContentManifestKey(config, teamId),
		previewRoot,
		previewId: previewId || undefined,
		overlayKey: previewId ? `${previewRoot}/${previewId}/overlay.json` : undefined,
		mode: previewId ? 'editorial_overlay' : 'production',
	};
}

export function isTeamScopedR2ContentEnabled(config: Pick<DeployConfig, 'providers' | 'cloudflare'>) {
	return config.providers?.content?.runtime === 'team_scoped_r2_overlay' && Boolean(config.cloudflare.r2?.binding);
}

export function signEditorialPreviewToken(payload: EditorialPreviewTokenPayload, secret: string) {
	const normalized = {
		teamId: expectString(payload.teamId, 'previewToken.teamId'),
		previewId: expectString(payload.previewId, 'previewToken.previewId'),
		expiresAt: expectString(payload.expiresAt, 'previewToken.expiresAt'),
	};
	const encodedPayload = base64UrlEncode(JSON.stringify(normalized));
	const signature = hmacSha256Base64Url(encodedPayload, secret);
	return `${encodedPayload}.${signature}`;
}
