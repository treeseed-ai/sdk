import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString } from 'mdast-util-to-string';
import { parseFrontmatterDocument } from '../../frontmatter.ts';
import type { TreeseedDeployConfig, TreeseedTenantConfig } from '../contracts.ts';
import { buildTenantBookRuntime } from '../books-data.ts';
import { exportBookLibrary, exportBookPackage } from '../book-export.ts';
import { COMMERCE_OFFER_MODES, type CommerceOfferMode } from '../../sdk-types.ts';
import {
	PUBLISHED_CONTENT_MANIFEST_SCHEMA_VERSION,
	resolvePublishedContentPreviewTtlHours,
	resolveTeamScopedContentLocator,
	type PublishContentObjectInput,
	type PublishedArtifactVersion,
	type PublishedCollectionIndex,
	type PublishedContentEntry,
	type PublishedContentManifest,
	type PublishedContentObjectPointer,
	type PublishedOverlayManifest,
	type PublishedRuntimePointers,
	type PublishedManifestTombstone,
	type PublishedContentVisibility,
} from '../published-content.ts';
import type { CatalogIndexEntry } from '../published-content.ts';
import { ArtifactBuilder, CollectionIndexBuilder, ContentSource, EntryRenderer, PublishedContentPipeline, PublishedContentPipelineContext, RuntimeBundleBuilder, artifactSignature, canonicalArtifactKey, canonicalEntryPath, entrySignature, objectInputForFile, resolveCommerceOfferMode, stableHash } from './resolve-commerce-offer-mode.ts';
import { DefaultCollectionIndexBuilder, DefaultEntryRenderer, DefaultRuntimeBundleBuilder, FilesystemContentSource, collectGeneratedArtifacts } from './list-markdown-files.ts';

export class DefaultArtifactBuilder implements ArtifactBuilder {
	async build(context: PublishedContentPipelineContext, entries: PublishedContentEntry[]) {
		const artifacts: PublishedArtifactVersion[] = [];
		const objects: PublishContentObjectInput[] = [];
		const catalog: CatalogIndexEntry[] = [];

		if (context.tenantConfig.content.books && existsSync(String(context.tenantConfig.content.books))) {
			const runtime = buildTenantBookRuntime(context.tenantConfig, { projectRoot: context.projectRoot });
			for (const book of runtime.BOOKS) {
				await exportBookPackage(book.slug, { projectRoot: context.projectRoot });
			}
			await exportBookLibrary({ projectRoot: context.projectRoot });
		}

		for (const filePath of collectGeneratedArtifacts(context.projectRoot)) {
			const artifact = objectInputForFile(context.teamId, filePath, 'artifacts');
			objects.push(artifact.object);
			const itemId = basename(filePath, extname(filePath));
			artifacts.push({
				id: `${itemId}-${String(context.sourceCommit ?? 'current').slice(0, 12) || context.generatedAt}`,
				itemId,
				kind: itemId === 'treeseed-knowledge' ? 'knowledge_pack' : 'book_export',
				version: String(context.sourceCommit ?? context.generatedAt).slice(0, 12) || context.generatedAt,
				label: itemId,
				visibility: 'public',
				teamId: context.teamId,
				publishedAt: context.generatedAt,
				content: artifact.pointer,
				metadata: {
					fileName: basename(filePath),
					source: 'generated',
				},
			});
		}

		for (const entry of entries.filter((candidate) => candidate.model === 'templates')) {
			const source = (entry.metadata?.fulfillment as Record<string, unknown> | undefined)?.source as Record<string, unknown> | undefined;
			if (!source || source.kind !== 'r2' || typeof source.objectKey !== 'string' || typeof source.version !== 'string') {
				continue;
			}
			artifacts.push({
				id: `${entry.slug}-${String(source.version)}`,
				itemId: entry.slug,
				kind: 'template_artifact',
				version: String(source.version),
				label: entry.title ?? entry.slug,
				visibility: entry.visibility,
				teamId: context.teamId,
				publishedAt: context.generatedAt,
				content: {
					objectKey: source.objectKey,
					sha256: typeof source.integrity === 'string' ? source.integrity : stableHash(source.objectKey),
					contentType: 'application/octet-stream',
					publicUrl: typeof source.publicUrl === 'string' ? source.publicUrl : undefined,
				},
				metadata: {
					manifestKey: resolveTeamScopedContentLocator(context.siteConfig, context.teamId).manifestKey,
					source,
				},
			});
		}

		for (const entry of entries.filter((candidate) => candidate.model === 'templates' || candidate.model === 'knowledge_packs')) {
			catalog.push({
				id: `${entry.model}:${entry.id}`,
				teamId: context.teamId,
				kind: entry.model === 'templates' ? 'template' : 'knowledge_pack',
				slug: entry.slug,
				title: entry.title ?? entry.slug,
				summary: entry.summary,
				visibility: entry.visibility,
				listingEnabled: entry.metadata?.listingEnabled !== false,
					offerMode: resolveCommerceOfferMode(entry.metadata?.offer?.priceModel),
				manifestKey: resolveTeamScopedContentLocator(context.siteConfig, context.teamId).manifestKey,
				artifactKey: undefined,
				updatedAt: context.generatedAt,
				searchText: [entry.title, entry.summary].filter(Boolean).join(' ').trim(),
				metadata: entry.metadata,
			});
		}

		return { artifacts, objects, catalog };
	}
}

export function dedupeObjects(objects: PublishContentObjectInput[]) {
	const deduped = new Map<string, PublishContentObjectInput>();
	for (const object of objects) {
		deduped.set(object.pointer.objectKey, object);
	}
	return [...deduped.values()];
}

export function buildTombstones(previousManifest: PublishedContentManifest | null | undefined, nextEntries: PublishedContentEntry[], generatedAt: string) {
	const previousEntries = previousManifest?.entries ?? [];
	const nextPaths = new Set(nextEntries.map((entry) => canonicalEntryPath(entry)));
	return previousEntries
		.filter((entry) => !nextPaths.has(canonicalEntryPath(entry)))
		.map((entry) => ({
			path: canonicalEntryPath(entry),
			removedAt: generatedAt,
			previousSha256: entry.content.sha256,
		})) satisfies PublishedManifestTombstone[];
}

export function filterChangedEntries(previousManifest: PublishedContentManifest | null | undefined, nextEntries: PublishedContentEntry[]) {
	const previous = new Map((previousManifest?.entries ?? []).map((entry) => [canonicalEntryPath(entry), entrySignature(entry)]));
	return nextEntries.filter((entry) => previous.get(canonicalEntryPath(entry)) !== entrySignature(entry));
}

export function filterChangedArtifacts(previousManifest: PublishedContentManifest | null | undefined, nextArtifacts: PublishedArtifactVersion[]) {
	const previous = new Map((previousManifest?.artifacts ?? []).map((artifact) => [canonicalArtifactKey(artifact), artifactSignature(artifact)]));
	return nextArtifacts.filter((artifact) => previous.get(canonicalArtifactKey(artifact)) !== artifactSignature(artifact));
}

export function collectReferencedObjectKeys(entries: PublishedContentEntry[], artifacts: PublishedArtifactVersion[], runtime: PublishedRuntimePointers | undefined) {
	const keys = new Set<string>();
	for (const entry of entries) {
		keys.add(entry.content.objectKey);
		if (entry.rendered?.objectKey) keys.add(entry.rendered.objectKey);
		if (entry.search?.objectKey) keys.add(entry.search.objectKey);
	}
	for (const artifact of artifacts) {
		keys.add(artifact.content.objectKey);
	}
	for (const pointer of [runtime?.booksRuntime, runtime?.docsTree, runtime?.searchIndex]) {
		if (pointer?.objectKey) keys.add(pointer.objectKey);
	}
	return keys;
}

export function changedRuntimePointers(
	previousManifest: PublishedContentManifest | null | undefined,
	nextRuntime: PublishedRuntimePointers,
) {
	const changed = new Set<string>();
	for (const key of ['booksRuntime', 'docsTree', 'searchIndex'] as const) {
		const nextPointer = nextRuntime[key];
		if (!nextPointer?.objectKey) {
			continue;
		}
		const previousPointer = previousManifest?.runtime?.[key];
		if (!previousPointer || previousPointer.sha256 !== nextPointer.sha256) {
			changed.add(nextPointer.objectKey);
		}
	}
	return changed;
}

export function createFilesystemContentSource(tenantConfig: TreeseedTenantConfig): ContentSource {
	return new FilesystemContentSource(tenantConfig);
}

export function createPublishedContentPipeline(context: PublishedContentPipelineContext, options: {
	contentSource?: ContentSource;
	entryRenderer?: EntryRenderer;
	collectionIndexBuilder?: CollectionIndexBuilder;
	runtimeBundleBuilder?: RuntimeBundleBuilder;
	artifactBuilder?: ArtifactBuilder;
} = {}): PublishedContentPipeline {
	const contentSource = options.contentSource ?? createFilesystemContentSource(context.tenantConfig);
	const entryRenderer = options.entryRenderer ?? new DefaultEntryRenderer();
	const collectionIndexBuilder = options.collectionIndexBuilder ?? new DefaultCollectionIndexBuilder();
	const runtimeBundleBuilder = options.runtimeBundleBuilder ?? new DefaultRuntimeBundleBuilder();
	const artifactBuilder = options.artifactBuilder ?? new DefaultArtifactBuilder();

	async function buildFullState() {
		const sourceEntries = await contentSource.listEntries();
		const renderedEntries = await Promise.all(sourceEntries.map((entry) => entryRenderer.render(entry, context)));
		const entries = renderedEntries.map((entry) => entry.entry);
		const objects = renderedEntries.flatMap((entry) => entry.objects);

		const collections = new Map<string, PublishedContentObjectPointer>();
		for (const [model, modelEntries] of Object.entries(Object.groupBy(entries, (entry) => entry.model))) {
			const actualEntries = (modelEntries ?? []).sort((left, right) => left.slug.localeCompare(right.slug));
			const { object } = await collectionIndexBuilder.build(model, actualEntries, context);
			collections.set(model, object.pointer);
			objects.push(object);
		}

		const runtimeBundle = await runtimeBundleBuilder.build(context, entries);
		objects.push(...runtimeBundle.objects);

		const artifactBundle = await artifactBuilder.build(context, entries);
		objects.push(...artifactBundle.objects);

		return {
			entries: entries.sort((left, right) => canonicalEntryPath(left).localeCompare(canonicalEntryPath(right))),
			artifacts: artifactBundle.artifacts.sort((left, right) => canonicalArtifactKey(left).localeCompare(canonicalArtifactKey(right))),
			runtime: runtimeBundle.runtime,
			collections: Object.fromEntries(collections),
			objects: dedupeObjects(objects),
			catalog: artifactBundle.catalog ?? [],
		};
	}

	return {
		async buildProductionRevision(options = {}) {
			const state = await buildFullState();
			const revisionSource = `${context.sourceRef ?? 'content'}:${context.sourceCommit ?? context.generatedAt}`;
			const revision = `${String(context.sourceRef ?? context.siteConfig.slug).replace(/[^a-zA-Z0-9._-]+/g, '-')}-${stableHash(revisionSource).slice(0, 12)}`;
			return {
				manifest: {
					schemaVersion: PUBLISHED_CONTENT_MANIFEST_SCHEMA_VERSION,
					siteSlug: context.siteConfig.slug,
					teamId: context.teamId,
					revision,
					generatedAt: context.generatedAt,
					mode: 'production',
					sourceCommit: context.sourceCommit ?? undefined,
					appRevision: context.sourceCommit ?? undefined,
					locator: resolveTeamScopedContentLocator(context.siteConfig, context.teamId),
					collections: state.collections,
					entries: state.entries,
					artifacts: state.artifacts,
					runtime: state.runtime,
					tombstones: buildTombstones(options.previousManifest, state.entries, context.generatedAt),
					metadata: {
						publishedFromBranch: context.sourceRef,
						publishedScope: 'prod',
					},
				},
				objects: state.objects,
				catalog: state.catalog,
			};
		},

		async buildEditorialOverlay(options) {
			const state = await buildFullState();
			const previousManifest = options.previousManifest ?? null;
			const changedEntries = filterChangedEntries(previousManifest, state.entries);
			const changedArtifacts = filterChangedArtifacts(previousManifest, state.artifacts);
			const tombstones = buildTombstones(previousManifest, state.entries, context.generatedAt);
			const referencedKeys = collectReferencedObjectKeys(changedEntries, changedArtifacts, undefined);
			for (const objectKey of changedRuntimePointers(previousManifest, state.runtime)) {
				referencedKeys.add(objectKey);
			}
			const changedObjects = state.objects.filter((object) => referencedKeys.has(object.pointer.objectKey));

			return {
				overlay: {
					schemaVersion: PUBLISHED_CONTENT_MANIFEST_SCHEMA_VERSION,
					siteSlug: context.siteConfig.slug,
					teamId: context.teamId,
					previewId: options.previewId,
					generatedAt: context.generatedAt,
					mode: 'editorial_overlay',
					baseManifestKey: resolveTeamScopedContentLocator(context.siteConfig, context.teamId).manifestKey,
					baseRevision: previousManifest?.revision,
					sourceCommit: context.sourceCommit ?? undefined,
					expiresAt: new Date(Date.now() + resolvePublishedContentPreviewTtlHours(context.siteConfig) * 60 * 60 * 1000).toISOString(),
					locator: resolveTeamScopedContentLocator(context.siteConfig, context.teamId, options.previewId),
					entries: changedEntries,
					artifacts: changedArtifacts,
					runtime: state.runtime,
					tombstones,
					metadata: {
						publishedFromBranch: context.sourceRef,
						publishedScope: 'staging',
					},
				},
				objects: dedupeObjects(changedObjects),
				catalog: state.catalog,
			};
		},
	};
}
