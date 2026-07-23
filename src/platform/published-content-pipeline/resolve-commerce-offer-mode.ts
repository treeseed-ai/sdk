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


export function resolveCommerceOfferMode(value: unknown): CommerceOfferMode {
	return typeof value === 'string' && (COMMERCE_OFFER_MODES as readonly string[]).includes(value)
		? value as CommerceOfferMode
		: 'free';
}

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

export function stableHash(value: Buffer | string) {
	return createHash('sha256').update(value).digest('hex');
}

export function inferContentType(fileName: string) {
	const extension = extname(fileName).toLowerCase();
	if (extension === '.json') return 'application/json';
	if (extension === '.md') return 'text/markdown; charset=utf-8';
	if (extension === '.mdx') return 'text/mdx; charset=utf-8';
	return 'application/octet-stream';
}

export function objectPointerForBuffer(
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

export function objectInputForJson(teamId: string, kind: 'objects' | 'artifacts', value: unknown): {
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

export function objectInputForFile(teamId: string, filePath: string, kind: 'objects' | 'artifacts') {
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

export function normalizeRelativeMarkdownPath(filePath: string, rootPath: string) {
	return relative(rootPath, filePath).replaceAll('\\', '/');
}

export function normalizeSlug(model: string, relativePath: string, frontmatter: Record<string, unknown>) {
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

export function inferTitle(relativePath: string, frontmatter: Record<string, unknown>) {
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

export function inferSummary(frontmatter: Record<string, unknown>, searchText: string) {
	for (const field of ['summary', 'description', 'excerpt']) {
		if (typeof frontmatter[field] === 'string' && frontmatter[field].trim()) {
			return frontmatter[field].trim();
		}
	}
	return searchText.trim().slice(0, 240) || undefined;
}

export function inferStatus(frontmatter: Record<string, unknown>) {
	if (typeof frontmatter.status === 'string' && frontmatter.status.trim()) {
		return frontmatter.status.trim();
	}
	if (frontmatter.draft === true) {
		return 'draft';
	}
	return 'live';
}

export function inferVisibility(frontmatter: Record<string, unknown>): PublishedContentVisibility {
	if (typeof frontmatter.visibility === 'string' && frontmatter.visibility.trim()) {
		return frontmatter.visibility.trim() as PublishedContentVisibility;
	}
	if (frontmatter.draft === true) {
		return 'team';
	}
	return 'public';
}

export function markdownText(body: string) {
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

export function canonicalEntryPath(entry: Pick<PublishedContentEntry, 'model' | 'slug' | 'id'>) {
	return `${entry.model}/${entry.slug || entry.id}`.replace(/^\/+|\/+$/g, '');
}

export function canonicalArtifactKey(artifact: PublishedArtifactVersion) {
	return `${artifact.kind}:${artifact.itemId}:${artifact.version}`;
}

export function entrySignature(entry: PublishedContentEntry) {
	const { publishedAt, ...rest } = entry;
	return stableHash(JSON.stringify(rest));
}

export function artifactSignature(artifact: PublishedArtifactVersion) {
	const { publishedAt, ...rest } = artifact;
	return stableHash(JSON.stringify(rest));
}
