import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString } from 'mdast-util-to-string';
import { parseFrontmatterDocument } from '../frontmatter.ts';
import type { TreeseedDeployConfig, TreeseedTenantConfig } from './contracts.ts';
import { buildTenantBookRuntime } from './books-data.ts';
import { exportBookLibrary, exportBookPackage } from './book-export.ts';
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
} from './published-content.ts';
import type { CatalogIndexEntry } from './published-content.ts';

export interface ContentSourceEntry {
	model: string;
	id: string;
	slug: string;
	title?: string;
	summary?: string;
	status?: string;
	visibility?: PublishedContentVisibility;
	frontmatter: Record<string, unknown>;
	body: string;
	relativePath: string;
	filePath: string;
	updatedAt: string;
}

export interface ContentSource {
	listEntries(): Promise<ContentSourceEntry[]>;
}

export interface RenderedContentEntry {
	entry: PublishedContentEntry;
	objects: PublishContentObjectInput[];
	searchText: string;
}

export interface EntryRenderer {
	render(entry: ContentSourceEntry, context: PublishedContentPipelineContext): Promise<RenderedContentEntry>;
}

export interface CollectionIndexBuilder {
	build(model: string, entries: PublishedContentEntry[], context: PublishedContentPipelineContext): Promise<{
		index: PublishedCollectionIndex;
		object: PublishContentObjectInput;
	}>;
}

export interface RuntimeBundleBuilderResult {
	runtime: PublishedRuntimePointers;
	objects: PublishContentObjectInput[];
}

export interface RuntimeBundleBuilder {
	build(context: PublishedContentPipelineContext, entries: PublishedContentEntry[]): Promise<RuntimeBundleBuilderResult>;
}

export interface ArtifactBuilderResult {
	artifacts: PublishedArtifactVersion[];
	objects: PublishContentObjectInput[];
	catalog?: CatalogIndexEntry[];
}

export interface ArtifactBuilder {
	build(context: PublishedContentPipelineContext, entries: PublishedContentEntry[]): Promise<ArtifactBuilderResult>;
}

export interface PublishedContentPipelineContext {
	projectRoot: string;
	siteConfig: TreeseedDeployConfig;
	tenantConfig: TreeseedTenantConfig;
	teamId: string;
	generatedAt: string;
	sourceCommit?: string | null;
	sourceRef?: string | null;
	previewId?: string | null;
}

export interface PublishedContentPipeline {
	buildProductionRevision(options?: { previousManifest?: PublishedContentManifest | null }): Promise<{
		manifest: PublishedContentManifest;
		objects: PublishContentObjectInput[];
		catalog: CatalogIndexEntry[];
	}>;
	buildEditorialOverlay(options?: { previousManifest?: PublishedContentManifest | null; previewId: string }): Promise<{
		overlay: PublishedOverlayManifest;
		objects: PublishContentObjectInput[];
		catalog: CatalogIndexEntry[];
	}>;
}

function stableHash(value: Buffer | string) {
	return createHash('sha256').update(value).digest('hex');
}

function inferContentType(fileName: string) {
	const extension = extname(fileName).toLowerCase();
	if (extension === '.json') return 'application/json';
	if (extension === '.md') return 'text/markdown; charset=utf-8';
	if (extension === '.mdx') return 'text/mdx; charset=utf-8';
	return 'application/octet-stream';
}

function objectPointerForBuffer(
	teamId: string,
	buffer: Buffer,
	kind: 'objects' | 'artifacts',
	extension = '.json',
): PublishedContentObjectPointer {
	const sha256 = stableHash(buffer);
	return {
		objectKey: `teams/${teamId}/${kind}/${sha256}${extension}`,
		sha256,
		size: buffer.byteLength,
		contentType: inferContentType(`entry${extension}`),
	};
}

function objectInputForJson(teamId: string, kind: 'objects' | 'artifacts', value: unknown): {
	pointer: PublishedContentObjectPointer;
	object: PublishContentObjectInput;
} {
	const buffer = Buffer.from(JSON.stringify(value, null, 2));
	const pointer = objectPointerForBuffer(teamId, buffer, kind, '.json');
	return {
		pointer,
		object: {
			pointer: { ...pointer, contentType: 'application/json' },
			body: buffer,
			httpMetadata: { contentType: 'application/json' },
		},
	};
}

function objectInputForFile(teamId: string, filePath: string, kind: 'objects' | 'artifacts') {
	const buffer = readFileSync(filePath);
	const extension = extname(filePath) || '.bin';
	const pointer = objectPointerForBuffer(teamId, buffer, kind, extension);
	return {
		pointer: { ...pointer, contentType: inferContentType(filePath) },
		object: {
			pointer: { ...pointer, contentType: inferContentType(filePath) },
			body: buffer,
			httpMetadata: { contentType: inferContentType(filePath) },
		},
	};
}

function normalizeRelativeMarkdownPath(filePath: string, rootPath: string) {
	return relative(rootPath, filePath).replaceAll('\\', '/');
}

function normalizeSlug(model: string, relativePath: string, frontmatter: Record<string, unknown>) {
	const configured = typeof frontmatter.slug === 'string' && frontmatter.slug.trim()
		? frontmatter.slug.trim()
		: relativePath.replace(/\.(md|mdx)$/iu, '').replace(/\/index$/iu, '').replace(/^\/+|\/+$/gu, '');
	if (model === 'docs') {
		if (configured === 'knowledge' || configured.startsWith('knowledge/')) {
			return configured;
		}
		return configured ? `knowledge/${configured}` : 'knowledge';
	}
	return configured || basename(relativePath, extname(relativePath));
}

function inferTitle(relativePath: string, frontmatter: Record<string, unknown>) {
	if (typeof frontmatter.title === 'string' && frontmatter.title.trim()) {
		return frontmatter.title.trim();
	}
	if (typeof frontmatter.name === 'string' && frontmatter.name.trim()) {
		return frontmatter.name.trim();
	}
	return basename(relativePath, extname(relativePath))
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, (character) => character.toUpperCase());
}

function inferSummary(frontmatter: Record<string, unknown>, searchText: string) {
	for (const field of ['summary', 'description', 'excerpt']) {
		if (typeof frontmatter[field] === 'string' && frontmatter[field].trim()) {
			return frontmatter[field].trim();
		}
	}
	return searchText.trim().slice(0, 240) || undefined;
}

function inferStatus(frontmatter: Record<string, unknown>) {
	if (typeof frontmatter.status === 'string' && frontmatter.status.trim()) {
		return frontmatter.status.trim();
	}
	if (frontmatter.draft === true) {
		return 'draft';
	}
	return 'live';
}

function inferVisibility(frontmatter: Record<string, unknown>): PublishedContentVisibility {
	if (typeof frontmatter.visibility === 'string' && frontmatter.visibility.trim()) {
		return frontmatter.visibility.trim() as PublishedContentVisibility;
	}
	if (frontmatter.draft === true) {
		return 'team';
	}
	return 'public';
}

function markdownText(body: string) {
	try {
		const tree = unified().use(remarkParse).parse(body);
		return toString(tree).replace(/\s+/g, ' ').trim();
	} catch {
		return body
			.replace(/`{1,3}[^`]*`{1,3}/g, ' ')
			.replace(/[#>*_~[\]()!-]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}
}

function canonicalEntryPath(entry: Pick<PublishedContentEntry, 'model' | 'slug' | 'id'>) {
	return `${entry.model}/${entry.slug || entry.id}`.replace(/^\/+|\/+$/g, '');
}

function canonicalArtifactKey(artifact: PublishedArtifactVersion) {
	return `${artifact.kind}:${artifact.itemId}:${artifact.version}`;
}

function entrySignature(entry: PublishedContentEntry) {
	const { publishedAt, ...rest } = entry;
	return stableHash(JSON.stringify(rest));
}

function artifactSignature(artifact: PublishedArtifactVersion) {
	const { publishedAt, ...rest } = artifact;
	return stableHash(JSON.stringify(rest));
}

function listMarkdownFiles(rootPath: string): string[] {
	if (!existsSync(rootPath)) {
		return [];
	}
	const stats = statSync(rootPath);
	if (stats.isFile()) {
		return rootPath.endsWith('.md') || rootPath.endsWith('.mdx') ? [rootPath] : [];
	}

	return readdirSync(rootPath, { withFileTypes: true })
		.flatMap((entry) => {
			const fullPath = join(rootPath, entry.name);
			if (entry.isDirectory()) {
				return listMarkdownFiles(fullPath);
			}
			if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
				return [fullPath];
			}
			return [];
		})
		.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

class FilesystemContentSource implements ContentSource {
	constructor(
		private readonly tenantConfig: TreeseedTenantConfig,
	) {}

	async listEntries(): Promise<ContentSourceEntry[]> {
		const entries: ContentSourceEntry[] = [];
		for (const [model, rootPath] of Object.entries(this.tenantConfig.content ?? {})) {
			if (!rootPath) continue;
			for (const filePath of listMarkdownFiles(String(rootPath))) {
				const relativePath = normalizeRelativeMarkdownPath(filePath, String(rootPath));
				const raw = readFileSync(filePath, 'utf8');
				const parsed = parseFrontmatterDocument(raw);
				const searchText = markdownText(parsed.body);
				const slug = normalizeSlug(model, relativePath, parsed.frontmatter);
				entries.push({
					model,
					id: basename(filePath, extname(filePath)),
					slug,
					title: inferTitle(relativePath, parsed.frontmatter),
					summary: inferSummary(parsed.frontmatter, searchText),
					status: inferStatus(parsed.frontmatter),
					visibility: inferVisibility(parsed.frontmatter),
					frontmatter: parsed.frontmatter,
					body: parsed.body,
					relativePath,
					filePath,
					updatedAt: statSync(filePath).mtime.toISOString(),
				});
			}
		}
		return entries;
	}
}

class DefaultEntryRenderer implements EntryRenderer {
	async render(entry: ContentSourceEntry, context: PublishedContentPipelineContext): Promise<RenderedContentEntry> {
		const contentPayload = {
			model: entry.model,
			id: entry.id,
			slug: entry.slug,
			title: entry.title,
			summary: entry.summary,
			status: entry.status,
			visibility: entry.visibility,
			frontmatter: entry.frontmatter,
			body: entry.body,
			relativePath: entry.relativePath,
			filePath: entry.filePath,
			updatedAt: entry.updatedAt,
		};
		const renderedPayload = {
			format: 'markdown',
			body: entry.body,
		};
		const searchText = markdownText(entry.body);
		const searchPayload = {
			model: entry.model,
			id: entry.id,
			slug: entry.slug,
			title: entry.title,
			summary: entry.summary,
			text: searchText,
			updatedAt: entry.updatedAt,
		};

		const content = objectInputForJson(context.teamId, 'objects', contentPayload);
		const rendered = objectInputForJson(context.teamId, 'objects', renderedPayload);
		const search = objectInputForJson(context.teamId, 'objects', searchPayload);

		return {
			entry: {
				id: entry.id,
				model: entry.model,
				slug: entry.slug,
				title: entry.title,
				summary: entry.summary,
				status: entry.status,
				visibility: entry.visibility,
				teamId: context.teamId,
				publishedAt: context.generatedAt,
				updatedAt: entry.updatedAt,
				content: content.pointer,
				rendered: rendered.pointer,
				search: search.pointer,
				metadata: {
					relativePath: entry.relativePath,
					...entry.frontmatter,
				},
			},
			objects: [content.object, rendered.object, search.object],
			searchText,
		};
	}
}

class DefaultCollectionIndexBuilder implements CollectionIndexBuilder {
	async build(model: string, entries: PublishedContentEntry[], context: PublishedContentPipelineContext) {
		const index: PublishedCollectionIndex = {
			model,
			generatedAt: context.generatedAt,
			count: entries.length,
			entries,
		};
		const object = objectInputForJson(context.teamId, 'objects', index);
		return { index, object: object.object };
	}
}

function buildDocsTree(entries: PublishedContentEntry[]) {
	return entries
		.filter((entry) => entry.model === 'docs')
		.map((entry) => ({
			id: entry.id,
			slug: entry.slug,
			title: entry.title,
			summary: entry.summary,
			path: entry.slug.startsWith('knowledge/') ? `/${entry.slug}/` : `/knowledge/${entry.slug}/`,
		}));
}

class DefaultRuntimeBundleBuilder implements RuntimeBundleBuilder {
	async build(context: PublishedContentPipelineContext, entries: PublishedContentEntry[]) {
		const objects: PublishContentObjectInput[] = [];
		const runtime: PublishedRuntimePointers = {};

		if (context.tenantConfig.content.books && existsSync(String(context.tenantConfig.content.books))) {
			const booksRuntime = buildTenantBookRuntime(context.tenantConfig, {
				projectRoot: context.projectRoot,
			});
			const pointer = objectInputForJson(context.teamId, 'objects', booksRuntime);
			objects.push(pointer.object);
			runtime.booksRuntime = pointer.pointer;
			runtime.docsHomePath = booksRuntime.TREESEED_LINKS.home;
		}

		const docsTree = buildDocsTree(entries);
		if (docsTree.length > 0) {
			const pointer = objectInputForJson(context.teamId, 'objects', docsTree);
			objects.push(pointer.object);
			runtime.docsTree = pointer.pointer;
			runtime.docsHomePath = runtime.docsHomePath ?? '/knowledge/';
		}

		const searchIndex = entries.map((entry) => ({
			id: `${entry.model}:${entry.id}`,
			model: entry.model,
			slug: entry.slug,
			title: entry.title,
			summary: entry.summary,
			search: entry.search?.objectKey ?? null,
			updatedAt: entry.updatedAt,
		}));
		if (searchIndex.length > 0) {
			const pointer = objectInputForJson(context.teamId, 'objects', searchIndex);
			objects.push(pointer.object);
			runtime.searchIndex = pointer.pointer;
		}

		return { runtime, objects };
	}
}

function collectGeneratedArtifacts(projectRoot: string) {
	const outputRoot = resolve(projectRoot, 'public', 'books');
	if (!existsSync(outputRoot)) {
		return [];
	}
	return readdirSync(outputRoot)
		.map((entry) => resolve(outputRoot, entry))
		.filter((filePath) => statSync(filePath).isFile() && extname(filePath).toLowerCase() === '.md')
		.sort((left, right) => left.localeCompare(right));
}

class DefaultArtifactBuilder implements ArtifactBuilder {
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
				offerMode: typeof entry.metadata?.offer?.priceModel === 'string'
					? entry.metadata.offer.priceModel as CatalogIndexEntry['offerMode']
					: 'free',
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

function dedupeObjects(objects: PublishContentObjectInput[]) {
	const deduped = new Map<string, PublishContentObjectInput>();
	for (const object of objects) {
		deduped.set(object.pointer.objectKey, object);
	}
	return [...deduped.values()];
}

function buildTombstones(previousManifest: PublishedContentManifest | null | undefined, nextEntries: PublishedContentEntry[], generatedAt: string) {
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

function filterChangedEntries(previousManifest: PublishedContentManifest | null | undefined, nextEntries: PublishedContentEntry[]) {
	const previous = new Map((previousManifest?.entries ?? []).map((entry) => [canonicalEntryPath(entry), entrySignature(entry)]));
	return nextEntries.filter((entry) => previous.get(canonicalEntryPath(entry)) !== entrySignature(entry));
}

function filterChangedArtifacts(previousManifest: PublishedContentManifest | null | undefined, nextArtifacts: PublishedArtifactVersion[]) {
	const previous = new Map((previousManifest?.artifacts ?? []).map((artifact) => [canonicalArtifactKey(artifact), artifactSignature(artifact)]));
	return nextArtifacts.filter((artifact) => previous.get(canonicalArtifactKey(artifact)) !== artifactSignature(artifact));
}

function collectReferencedObjectKeys(entries: PublishedContentEntry[], artifacts: PublishedArtifactVersion[], runtime: PublishedRuntimePointers | undefined) {
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

function changedRuntimePointers(
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
