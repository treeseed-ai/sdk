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
import { CollectionIndexBuilder, ContentSource, ContentSourceEntry, EntryRenderer, PublishedContentPipelineContext, RenderedContentEntry, RuntimeBundleBuilder, inferStatus, inferSummary, inferTitle, inferVisibility, markdownText, normalizeRelativeMarkdownPath, normalizeSlug, objectInputForJson } from './resolve-commerce-offer-mode.ts';

export function listMarkdownFiles(rootPath: string): string[] {
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

export class FilesystemContentSource implements ContentSource {
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

export class DefaultEntryRenderer implements EntryRenderer {
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

export class DefaultCollectionIndexBuilder implements CollectionIndexBuilder {
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

export function buildDocsTree(entries: PublishedContentEntry[]) {
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

export class DefaultRuntimeBundleBuilder implements RuntimeBundleBuilder {
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

export function collectGeneratedArtifacts(projectRoot: string) {
	const outputRoot = resolve(projectRoot, 'public', 'books');
	if (!existsSync(outputRoot)) {
		return [];
	}
	return readdirSync(outputRoot)
		.map((entry) => resolve(outputRoot, entry))
		.filter((filePath) => statSync(filePath).isFile() && extname(filePath).toLowerCase() === '.md')
		.sort((left, right) => left.localeCompare(right));
}
