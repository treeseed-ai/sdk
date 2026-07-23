import type { TreeseedDeployConfig } from '../contracts.ts';
import type { CommerceOfferMode } from '../../sdk-types.ts';
import type { CloudflareRuntime, R2BucketLike } from '../../types/cloudflare.ts';
import { ContentPublishProvider, ContentRuntimeProvider, PromoteOverlayInput, PublishContentRevisionInput, PublishContentRevisionResult, PublishOverlayInput, PublishOverlayResult, PublishedCollectionIndex, PublishedContentManifest, PublishedContentObjectPointer, PublishedOverlayManifest, TeamScopedContentLocator, stableHash } from './published-content-manifest-schema-version.ts';
import { collectManifestPointers, mergeEntries, mergeManifests, putContentObjects, readJsonObject, readPublishedContentManifest, readPublishedOverlayManifest } from './verify-editorial-preview-token.ts';
import { parsePublishedCollectionIndex } from './hmac-sha256-base64-url.ts';

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
