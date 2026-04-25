import type { TreeseedDeployConfig } from './contracts.ts';
import type { CloudflareRuntime, R2BucketLike } from '../types/cloudflare.ts';

export const PUBLISHED_CONTENT_MANIFEST_SCHEMA_VERSION = 2;
export const EDITORIAL_PREVIEW_COOKIE = 'treeseed-content-preview';

export type PublishedContentVisibility = 'public' | 'authenticated' | 'team' | 'private';
export type HostedContentMode = 'production' | 'editorial_overlay';

export interface PublishedContentObjectPointer {
	objectKey: string;
	sha256: string;
	size?: number;
	contentType?: string;
	publicUrl?: string;
}

export interface PublishedContentEntry {
	id: string;
	model: string;
	slug: string;
	title?: string;
	summary?: string;
	status?: string;
	visibility?: PublishedContentVisibility;
	teamId?: string;
	publishedAt?: string;
	updatedAt?: string;
	content: PublishedContentObjectPointer;
	rendered?: PublishedContentObjectPointer;
	search?: PublishedContentObjectPointer;
	metadata?: Record<string, unknown>;
}

export interface PublishedCollectionIndex {
	model: string;
	generatedAt: string;
	count?: number;
	entries: PublishedContentEntry[];
}

export interface PublishedArtifactVersion {
	id: string;
	itemId: string;
	kind: string;
	version: string;
	label?: string;
	visibility?: PublishedContentVisibility;
	teamId?: string;
	publishedAt: string;
	content: PublishedContentObjectPointer;
	metadata?: Record<string, unknown>;
}

export interface PublishedManifestTombstone {
	path: string;
	removedAt: string;
	previousSha256?: string;
}

export interface TeamScopedContentLocator {
	teamId: string;
	manifestKey: string;
	previewRoot: string;
	overlayKey?: string;
	previewId?: string;
	mode?: HostedContentMode;
}

export interface CatalogIndexEntry {
	id: string;
	teamId: string;
	kind: string;
	slug: string;
	title: string;
	summary?: string;
	visibility?: PublishedContentVisibility;
	listingEnabled?: boolean;
	offerMode?: 'free' | 'paid' | 'contact' | 'one_time_current_version' | 'subscription_updates' | 'private';
	manifestKey?: string;
	artifactKey?: string;
	updatedAt: string;
	searchText?: string;
	metadata?: Record<string, unknown>;
}

export type PublishedRuntimePointers = {
	docsHomePath?: string;
	booksRuntime?: PublishedContentObjectPointer;
	docsTree?: PublishedContentObjectPointer;
	searchIndex?: PublishedContentObjectPointer;
};

export interface PublishedContentManifest {
	schemaVersion: number;
	siteSlug: string;
	teamId: string;
	revision: string;
	generatedAt: string;
	mode?: HostedContentMode;
	sourceCommit?: string;
	appRevision?: string;
	appCompatibility?: {
		min?: string;
		max?: string;
		lastKnownCompatibleRevision?: string;
	};
	locator?: TeamScopedContentLocator;
	collections?: Record<string, PublishedContentObjectPointer>;
	entries: PublishedContentEntry[];
	artifacts?: PublishedArtifactVersion[];
	runtime?: PublishedRuntimePointers;
	tombstones?: PublishedManifestTombstone[];
	metadata?: Record<string, unknown>;
}

export interface PublishedOverlayManifest {
	schemaVersion: number;
	siteSlug: string;
	teamId: string;
	previewId: string;
	generatedAt: string;
	mode?: HostedContentMode;
	baseManifestKey: string;
	baseRevision?: string;
	sourceCommit?: string;
	expiresAt?: string;
	locator?: TeamScopedContentLocator;
	collections?: Record<string, PublishedContentObjectPointer>;
	entries?: PublishedContentEntry[];
	artifacts?: PublishedArtifactVersion[];
	runtime?: PublishedRuntimePointers;
	tombstones?: PublishedManifestTombstone[];
	metadata?: Record<string, unknown>;
}

export interface ContentRuntimeProvider {
	getManifest(): Promise<PublishedContentManifest>;
	getProductionManifest(): Promise<PublishedContentManifest>;
	getOverlayManifest(): Promise<PublishedOverlayManifest | null>;
	getCollectionIndex(model: string): Promise<PublishedCollectionIndex>;
	listCollection(model: string): Promise<PublishedContentEntry[]>;
	getEntry(model: string, slugOrId: string): Promise<PublishedContentEntry | null>;
	getArtifactVersion(itemId: string, version?: string): Promise<PublishedArtifactVersion | null>;
	getObject<T = unknown>(pointer: string | PublishedContentObjectPointer): Promise<T | null>;
}

export interface PublishContentObjectInput {
	pointer: PublishedContentObjectPointer;
	body: string | ArrayBuffer | ArrayBufferView;
	httpMetadata?: Record<string, unknown>;
	customMetadata?: Record<string, string>;
}

export interface PublishContentRevisionInput {
	manifest: PublishedContentManifest;
	objects: PublishContentObjectInput[];
}

export interface PublishOverlayInput {
	overlay: PublishedOverlayManifest;
	objects: PublishContentObjectInput[];
}

export interface PublishContentRevisionResult {
	revision: string;
	manifestKey: string;
}

export interface PublishOverlayResult {
	previewId: string;
	overlayKey: string;
}

export interface PromoteOverlayInput {
	previewId: string;
	revision?: string;
	generatedAt?: string;
	sourceCommit?: string;
	appRevision?: string;
}

export interface ContentPublishProvider {
	publishRevision(input: PublishContentRevisionInput): Promise<PublishContentRevisionResult>;
	publishOverlay(input: PublishOverlayInput): Promise<PublishOverlayResult>;
	promoteOverlay(input: PromoteOverlayInput): Promise<PublishContentRevisionResult>;
	rollbackRevision(snapshotKey: string): Promise<PublishContentRevisionResult>;
	deleteOverlay(previewId: string, overlay?: PublishedOverlayManifest | null): Promise<void>;
}

export interface EditorialPreviewTokenPayload {
	teamId: string;
	previewId: string;
	expiresAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`Invalid published content payload: expected ${label} to be an object.`);
	}

	return value;
}

function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Invalid published content payload: expected ${label} to be a non-empty string.`);
	}

	return value.trim();
}

function optionalString(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown) {
	return typeof value === 'boolean' ? value : undefined;
}

function getNodeCrypto():
	| {
		createHash?: (algorithm: string) => { update: (value: string) => { digest: (encoding: 'hex') => string } };
		createHmac?: (algorithm: string, secret: string) => { update: (value: string) => { digest: (encoding: 'base64url') => string } };
	}
	| null {
	return (globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }).process
		?.getBuiltinModule?.('crypto') as ReturnType<typeof getNodeCrypto> ?? null;
}

function stableHash(value: string) {
	const crypto = getNodeCrypto();
	if (crypto?.createHash) {
		return crypto.createHash('sha256').update(value).digest('hex');
	}

	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function hmacSha256Base64Url(value: string, secret: string) {
	const crypto = getNodeCrypto();
	if (!crypto?.createHmac) {
		throw new Error('Editorial preview token signing requires a crypto runtime.');
	}

	return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function base64UrlEncode(value: string) {
	return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string) {
	return Buffer.from(value, 'base64url').toString('utf8');
}

function canonicalEntryPath(entry: Pick<PublishedContentEntry, 'model' | 'slug' | 'id'>) {
	return `${entry.model}/${entry.slug || entry.id}`.replace(/^\/+|\/+$/g, '');
}

function normalizeObjectPointer(value: unknown, label: string): PublishedContentObjectPointer {
	const record = expectRecord(value, label);
	return {
		objectKey: expectString(record.objectKey ?? record.key, `${label}.objectKey`),
		sha256: expectString(record.sha256, `${label}.sha256`),
		size: optionalNumber(record.size),
		contentType: optionalString(record.contentType),
		publicUrl: optionalString(record.publicUrl),
	};
}

function normalizeRuntimePointers(value: unknown, label: string): PublishedRuntimePointers | undefined {
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

function normalizeLocator(value: unknown, label: string): TeamScopedContentLocator | undefined {
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

function normalizeContentEntry(value: unknown, label: string): PublishedContentEntry {
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

function normalizeArtifactVersion(value: unknown, label: string): PublishedArtifactVersion {
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

function normalizeTombstones(value: unknown): PublishedManifestTombstone[] {
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

export function resolvePublishedContentBucketBinding(config: Pick<TreeseedDeployConfig, 'cloudflare'>) {
	return config.cloudflare.r2?.binding ?? 'TREESEED_CONTENT_BUCKET';
}

function fillTeamTemplate(template: string, teamId: string) {
	return template.replaceAll('{teamId}', teamId);
}

export function resolvePublishedContentManifestKey(
	config: Pick<TreeseedDeployConfig, 'cloudflare'> & Partial<Pick<TreeseedDeployConfig, 'slug'>>,
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
	config: Pick<TreeseedDeployConfig, 'cloudflare'> & Partial<Pick<TreeseedDeployConfig, 'slug'>>,
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

export function resolvePublishedContentPreviewTtlHours(config: Pick<TreeseedDeployConfig, 'cloudflare'>) {
	return config.cloudflare.r2?.previewTtlHours ?? 168;
}

export function resolveTeamScopedContentLocator(
	config: Pick<TreeseedDeployConfig, 'cloudflare'>,
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

export function isTeamScopedR2ContentEnabled(config: Pick<TreeseedDeployConfig, 'providers' | 'cloudflare'>) {
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

export function verifyEditorialPreviewToken(token: string, secret: string): EditorialPreviewTokenPayload | null {
	const [encodedPayload, signature] = String(token ?? '').split('.');
	if (!encodedPayload || !signature) {
		return null;
	}
	let expected: string;
	try {
		expected = hmacSha256Base64Url(encodedPayload, secret);
	} catch {
		return null;
	}
	if (expected !== signature) {
		return null;
	}
	const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Record<string, unknown>;
	const normalized = {
		teamId: expectString(payload.teamId, 'previewToken.teamId'),
		previewId: expectString(payload.previewId, 'previewToken.previewId'),
		expiresAt: expectString(payload.expiresAt, 'previewToken.expiresAt'),
	};
	if (Date.parse(normalized.expiresAt) <= Date.now()) {
		return null;
	}
	return normalized;
}

export function resolveCloudflareR2Bucket(
	runtime: CloudflareRuntime | null | undefined,
	binding: string,
): R2BucketLike | null {
	if (!runtime?.env || !binding) {
		return null;
	}
	const candidate = runtime.env[binding];
	return candidate && typeof candidate === 'object' ? candidate as R2BucketLike : null;
}

async function readJsonObject<T>(bucket: R2BucketLike, key: string): Promise<T | null> {
	const object = await bucket.get(key);
	return object ? object.json<T>() : null;
}

export async function readPublishedContentManifest(bucket: R2BucketLike, manifestKey: string) {
	const payload = await readJsonObject<unknown>(bucket, manifestKey);
	return payload ? parsePublishedContentManifest(payload) : null;
}

export async function readPublishedOverlayManifest(bucket: R2BucketLike, overlayKey: string) {
	const payload = await readJsonObject<unknown>(bucket, overlayKey);
	return payload ? parsePublishedOverlayManifest(payload) : null;
}

function mergeEntries(
	baseEntries: PublishedContentEntry[],
	overlayEntries: PublishedContentEntry[] = [],
	tombstones: PublishedManifestTombstone[] = [],
): PublishedContentEntry[] {
	const removed = new Set(tombstones.map((entry) => entry.path));
	const merged = new Map<string, PublishedContentEntry>();
	for (const entry of baseEntries) {
		const key = canonicalEntryPath(entry);
		if (!removed.has(key)) {
			merged.set(key, entry);
		}
	}
	for (const entry of overlayEntries) {
		merged.set(canonicalEntryPath(entry), entry);
	}
	return [...merged.values()];
}

function mergeArtifacts(
	baseArtifacts: PublishedArtifactVersion[] = [],
	overlayArtifacts: PublishedArtifactVersion[] = [],
): PublishedArtifactVersion[] {
	const merged = new Map<string, PublishedArtifactVersion>();
	for (const artifact of baseArtifacts) {
		merged.set(`${artifact.itemId}:${artifact.version}`, artifact);
	}
	for (const artifact of overlayArtifacts) {
		merged.set(`${artifact.itemId}:${artifact.version}`, artifact);
	}
	return [...merged.values()];
}

function mergeRuntimePointers(baseRuntime?: PublishedRuntimePointers, overlayRuntime?: PublishedRuntimePointers) {
	return overlayRuntime ? { ...(baseRuntime ?? {}), ...overlayRuntime } : baseRuntime;
}

function mergeManifests(
	production: PublishedContentManifest,
	overlay: PublishedOverlayManifest | null,
): PublishedContentManifest {
	if (!overlay) {
		return production;
	}

	return {
		...production,
		mode: 'editorial_overlay',
		generatedAt: overlay.generatedAt,
		sourceCommit: overlay.sourceCommit ?? production.sourceCommit,
		locator: overlay.locator ?? production.locator,
		collections: {
			...(production.collections ?? {}),
			...(overlay.collections ?? {}),
		},
		entries: mergeEntries(production.entries, overlay.entries ?? [], overlay.tombstones ?? []),
		artifacts: mergeArtifacts(production.artifacts ?? [], overlay.artifacts ?? []),
		runtime: mergeRuntimePointers(production.runtime, overlay.runtime),
		tombstones: [...(production.tombstones ?? []), ...(overlay.tombstones ?? [])],
		metadata: {
			...(production.metadata ?? {}),
			...(overlay.metadata ?? {}),
			overlayPreviewId: overlay.previewId,
			overlayExpiresAt: overlay.expiresAt,
		},
	};
}

function collectManifestPointers(manifest: PublishedContentManifest | PublishedOverlayManifest) {
	const pointers: PublishedContentObjectPointer[] = [];
	for (const pointer of Object.values(manifest.collections ?? {})) {
		pointers.push(pointer);
	}
	for (const entry of manifest.entries ?? []) {
		pointers.push(entry.content);
		if (entry.rendered) pointers.push(entry.rendered);
		if (entry.search) pointers.push(entry.search);
	}
	for (const artifact of manifest.artifacts ?? []) {
		pointers.push(artifact.content);
	}
	if (manifest.runtime?.booksRuntime) pointers.push(manifest.runtime.booksRuntime);
	if (manifest.runtime?.docsTree) pointers.push(manifest.runtime.docsTree);
	if (manifest.runtime?.searchIndex) pointers.push(manifest.runtime.searchIndex);
	return pointers;
}

async function putContentObjects(bucket: R2BucketLike, objects: PublishContentObjectInput[]) {
	for (const object of objects) {
		await bucket.put(object.pointer.objectKey, object.body, {
			httpMetadata: object.httpMetadata,
			customMetadata: object.customMetadata,
		});
	}
}

export class TeamScopedR2OverlayContentRuntimeProvider implements ContentRuntimeProvider {
	private productionManifestPromise: Promise<PublishedContentManifest> | null = null;
	private overlayManifestPromise: Promise<PublishedOverlayManifest | null> | null = null;
	private manifestPromise: Promise<PublishedContentManifest> | null = null;
	private readonly collectionCache = new Map<string, Promise<PublishedCollectionIndex>>();

	constructor(
		private readonly bucket: R2BucketLike,
		private readonly locator: TeamScopedContentLocator,
	) {}

	async getProductionManifest() {
		if (!this.productionManifestPromise) {
			this.productionManifestPromise = (async () => {
				const manifest = await readPublishedContentManifest(this.bucket, this.locator.manifestKey);
				if (!manifest) {
					const overlay = this.locator.overlayKey
						? await readPublishedOverlayManifest(this.bucket, this.locator.overlayKey)
						: null;
					if (overlay) {
						return {
							schemaVersion: overlay.schemaVersion,
							siteSlug: overlay.siteSlug,
							teamId: overlay.teamId,
							revision: overlay.baseRevision ?? 'unpublished',
							generatedAt: overlay.generatedAt,
							mode: 'production',
							sourceCommit: overlay.sourceCommit,
							locator: {
								...this.locator,
								mode: 'production',
								overlayKey: undefined,
								previewId: undefined,
							},
							collections: {},
							entries: [],
							artifacts: [],
							runtime: {},
							tombstones: [],
							metadata: {
								overlayOnly: true,
							},
						} satisfies PublishedContentManifest;
					}
					throw new Error(`Published content manifest "${this.locator.manifestKey}" was not found in R2.`);
				}
				return manifest;
			})();
		}
		return this.productionManifestPromise;
	}

	async getOverlayManifest() {
		if (!this.locator.overlayKey) {
			return null;
		}
		if (!this.overlayManifestPromise) {
			this.overlayManifestPromise = readPublishedOverlayManifest(this.bucket, this.locator.overlayKey);
		}
		return this.overlayManifestPromise;
	}

	async getManifest() {
		if (!this.manifestPromise) {
			this.manifestPromise = (async () => mergeManifests(await this.getProductionManifest(), await this.getOverlayManifest()))();
		}
		return this.manifestPromise;
	}

	async getCollectionIndex(model: string) {
		if (!this.collectionCache.has(model)) {
			this.collectionCache.set(model, (async () => {
				const [manifest, overlay, production] = await Promise.all([
					this.getManifest(),
					this.getOverlayManifest(),
					this.getProductionManifest(),
				]);
				const pointer = manifest.collections?.[model];
				if (!pointer) {
					return {
						model,
						generatedAt: manifest.generatedAt,
						count: 0,
						entries: manifest.entries.filter((entry) => entry.model === model),
					};
				}
				const payload = await readJsonObject<unknown>(this.bucket, pointer.objectKey);
				if (!payload) {
					throw new Error(`Published collection index "${pointer.objectKey}" for model "${model}" was not found.`);
				}
				const parsed = parsePublishedCollectionIndex(payload);
				if (!overlay) {
					return parsed;
				}
				const baseIndexPointer = production.collections?.[model];
				const basePayload = baseIndexPointer && baseIndexPointer.objectKey !== pointer.objectKey
					? await readJsonObject<unknown>(this.bucket, baseIndexPointer.objectKey)
					: null;
				const baseEntries = basePayload ? parsePublishedCollectionIndex(basePayload).entries : parsed.entries;
				return {
					model,
					generatedAt: manifest.generatedAt,
					count: undefined,
					entries: mergeEntries(
						baseEntries,
						(overlay.entries ?? []).filter((entry) => entry.model === model),
						(overlay.tombstones ?? []).filter((entry) => entry.path.startsWith(`${model}/`)),
					),
				};
			})());
		}
		return this.collectionCache.get(model)!;
	}

	async listCollection(model: string) {
		return (await this.getCollectionIndex(model)).entries;
	}

	async getEntry(model: string, slugOrId: string) {
		const normalized = String(slugOrId).trim().replace(/^\/+|\/+$/g, '');
		const manifest = await this.getManifest();
		const fromManifest = manifest.entries.find((entry) => entry.model === model && (entry.slug === normalized || entry.id === normalized));
		if (fromManifest) {
			return fromManifest;
		}
		const index = await this.getCollectionIndex(model);
		return index.entries.find((entry) => entry.slug === normalized || entry.id === normalized) ?? null;
	}

	async getArtifactVersion(itemId: string, version?: string) {
		const manifest = await this.getManifest();
		const candidates = (manifest.artifacts ?? []).filter((artifact) => artifact.itemId === itemId);
		if (!candidates.length) {
			return null;
		}
		if (version) {
			return candidates.find((artifact) => artifact.version === version || artifact.id === version) ?? null;
		}
		return [...candidates].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))[0] ?? null;
	}

	async getObject<T = unknown>(pointer: string | PublishedContentObjectPointer) {
		const objectKey = typeof pointer === 'string' ? pointer : pointer.objectKey;
		return readJsonObject<T>(this.bucket, objectKey);
	}
}

export class TeamScopedR2OverlayContentPublishProvider implements ContentPublishProvider {
	constructor(
		private readonly bucket: R2BucketLike,
		private readonly locator: TeamScopedContentLocator,
	) {}

	async publishRevision(input: PublishContentRevisionInput): Promise<PublishContentRevisionResult> {
		await putContentObjects(this.bucket, input.objects);
		const snapshotKey = this.locator.manifestKey.replace(/\/common\.json$/u, `/manifests/${input.manifest.revision}.json`);
		await this.bucket.put(snapshotKey, JSON.stringify(input.manifest, null, 2));
		await this.bucket.put(this.locator.manifestKey, JSON.stringify(input.manifest, null, 2));
		return {
			revision: input.manifest.revision,
			manifestKey: this.locator.manifestKey,
		};
	}

	async publishOverlay(input: PublishOverlayInput): Promise<PublishOverlayResult> {
		await putContentObjects(this.bucket, input.objects);
		const overlayKey = input.overlay.locator?.overlayKey
			?? `${this.locator.previewRoot}/${input.overlay.previewId}/overlay.json`;
		await this.bucket.put(overlayKey, JSON.stringify(input.overlay, null, 2));
		return {
			previewId: input.overlay.previewId,
			overlayKey,
		};
	}

	async promoteOverlay(input: PromoteOverlayInput): Promise<PublishContentRevisionResult> {
		const production = await readPublishedContentManifest(this.bucket, this.locator.manifestKey);
		if (!production) {
			throw new Error(`Published content manifest "${this.locator.manifestKey}" was not found in R2.`);
		}
		const overlayKey = `${this.locator.previewRoot}/${input.previewId}/overlay.json`;
		const overlay = await readPublishedOverlayManifest(this.bucket, overlayKey);
		if (!overlay) {
			throw new Error(`Editorial overlay "${overlayKey}" was not found in R2.`);
		}
		const merged = mergeManifests(production, overlay);
		const nextManifest: PublishedContentManifest = {
			...merged,
			mode: 'production',
			revision: input.revision ?? `${overlay.previewId}-${stableHash(`${overlay.generatedAt}:${overlay.previewId}`).slice(0, 12)}`,
			generatedAt: input.generatedAt ?? new Date().toISOString(),
			sourceCommit: input.sourceCommit ?? overlay.sourceCommit ?? merged.sourceCommit,
			appRevision: input.appRevision ?? merged.appRevision,
			locator: {
				...this.locator,
				mode: 'production',
				overlayKey: undefined,
				previewId: undefined,
			},
		};
		return this.publishRevision({
			manifest: nextManifest,
			objects: [],
		});
	}

	async rollbackRevision(snapshotKey: string): Promise<PublishContentRevisionResult> {
		const manifest = await readPublishedContentManifest(this.bucket, snapshotKey);
		if (!manifest) {
			throw new Error(`Published content snapshot "${snapshotKey}" was not found in R2.`);
		}
		await this.bucket.put(this.locator.manifestKey, JSON.stringify(manifest, null, 2));
		return {
			revision: manifest.revision,
			manifestKey: this.locator.manifestKey,
		};
	}

	async deleteOverlay(previewId: string, overlay: PublishedOverlayManifest | null = null): Promise<void> {
		const overlayKey = `${this.locator.previewRoot}/${previewId}/overlay.json`;
		if (this.bucket.delete) {
			const manifest = overlay ?? await readPublishedOverlayManifest(this.bucket, overlayKey);
			const keys = new Set<string>([overlayKey]);
			for (const pointer of manifest ? collectManifestPointers(manifest) : []) {
				keys.add(pointer.objectKey);
			}
			await this.bucket.delete([...keys]);
		}
	}
}

export function createTeamScopedR2OverlayContentRuntimeProvider(options: {
	bucket: R2BucketLike;
	locator: TeamScopedContentLocator;
}) {
	return new TeamScopedR2OverlayContentRuntimeProvider(options.bucket, options.locator);
}

export function createTeamScopedR2OverlayContentPublishProvider(options: {
	bucket: R2BucketLike;
	locator: TeamScopedContentLocator;
}) {
	return new TeamScopedR2OverlayContentPublishProvider(options.bucket, options.locator);
}
