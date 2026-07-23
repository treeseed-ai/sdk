import type { TreeseedDeployConfig } from '../contracts.ts';
import type { CommerceOfferMode } from '../../sdk-types.ts';
import type { CloudflareRuntime, R2BucketLike } from '../../types/cloudflare.ts';
import { EditorialPreviewTokenPayload, PublishContentObjectInput, PublishedArtifactVersion, PublishedContentEntry, PublishedContentManifest, PublishedContentObjectPointer, PublishedManifestTombstone, PublishedOverlayManifest, PublishedRuntimePointers, expectString } from './published-content-manifest-schema-version.ts';
import { base64UrlDecode, canonicalEntryPath, hmacSha256Base64Url, parsePublishedContentManifest, parsePublishedOverlayManifest } from './hmac-sha256-base64-url.ts';

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

export async function readJsonObject<T>(bucket: R2BucketLike, key: string): Promise<T | null> {
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

export function mergeEntries(
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

export function mergeArtifacts(
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

export function mergeRuntimePointers(baseRuntime?: PublishedRuntimePointers, overlayRuntime?: PublishedRuntimePointers) {
	return overlayRuntime ? { ...(baseRuntime ?? {}), ...overlayRuntime } : baseRuntime;
}

export function mergeManifests(
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

export function collectManifestPointers(manifest: PublishedContentManifest | PublishedOverlayManifest) {
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

export async function putContentObjects(bucket: R2BucketLike, objects: PublishContentObjectInput[]) {
	for (const object of objects) {
		await bucket.put(object.pointer.objectKey, object.body, {
			httpMetadata: object.httpMetadata,
			customMetadata: object.customMetadata,
		});
	}
}
