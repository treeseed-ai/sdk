import type { TreeseedDeployConfig } from '../contracts.ts';
import type { CommerceOfferMode } from '../../sdk-types.ts';
import type { CloudflareRuntime, R2BucketLike } from '../../types/cloudflare.ts';


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
	offerMode?: CommerceOfferMode;
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

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expectRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`Invalid published content payload: expected ${label} to be an object.`);
	}

	return value;
}

export function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Invalid published content payload: expected ${label} to be a non-empty string.`);
	}

	return value.trim();
}

export function optionalString(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function optionalNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function optionalBoolean(value: unknown) {
	return typeof value === 'boolean' ? value : undefined;
}

export function getNodeCrypto():
	| {
		createHash?: (algorithm: string) => { update: (value: string) => { digest: (encoding: 'hex') => string } };
		createHmac?: (algorithm: string, secret: string) => { update: (value: string) => { digest: (encoding: 'base64url') => string } };
	}
	| null {
	return (globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }).process
		?.getBuiltinModule?.('crypto') as ReturnType<typeof getNodeCrypto> ?? null;
}

export function stableHash(value: string) {
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
