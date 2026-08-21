import { parseFrontmatterDocument } from '../../../content/frontmatter.ts';
import { CONTENT_PUBLICATION_CONTRACT,type ContentPublicationObject } from '../publication-contracts.ts';
import type {
	PublishedCollectionIndex,
	PublishedContentEntry,
	PublishedContentObjectPointer,
	PublishedRuntimePointers,
} from '../published-content-manifest-schema-version.ts';
import { parsePublishedContentManifest } from '../hmac-sha256-base64-url.ts';
import {
	inferStatus,
	inferSummary,
	inferTitle,
	inferVisibility,
	markdownText,
	normalizeSlug,
} from '../../published-content-pipeline/resolve-publication-access-mode.ts';
import { createHash } from 'node:crypto';

export interface RuntimePublicationSource {
	path: string;
	body: string;
	sha256: string;
	byteLength: number;
	mediaType: string;
}

export interface RuntimePublicationObject {
	object: ContentPublicationObject;
	body: string;
}

const collectionAliases: Record<string, string> = {
	'agent-tests': 'agent_tests',
	'discussion-events': 'discussion_events',
	'discussion-messages': 'discussion_messages',
	'group-edges': 'group_edges',
	knowledge: 'docs',
};

function digest(value: string) {
	return createHash('sha256').update(value).digest('hex');
}

function contentPointer(object: ContentPublicationObject): PublishedContentObjectPointer {
	return {
		objectKey: object.objectKey,
		sha256: object.sha256,
		size: object.byteLength,
		contentType: object.mediaType,
	};
}

function jsonObject(objectRoot: string, path: string, value: unknown): RuntimePublicationObject {
	const body = `${JSON.stringify(value, null, 2)}\n`;
	const sha256 = digest(body);
	return {
		object: {
			path,
			objectKey: `${objectRoot}/runtime/${sha256}.json`,
			sha256,
			byteLength: Buffer.byteLength(body, 'utf8'),
			mediaType: 'application/json; charset=utf-8',
		},
		body,
	};
}

function sourceIdentity(path: string) {
	const [directory, ...relativeParts] = path.split('/');
	if (!directory || relativeParts.length === 0 || !/\.mdx?$/iu.test(path)) return null;
	const model = collectionAliases[directory] ?? directory.replaceAll('-', '_');
	const relativePath = relativeParts.join('/');
	return { model, relativePath };
}

function entryId(relativePath: string, frontmatter: Record<string, unknown>) {
	const configured = typeof frontmatter.id === 'string' ? frontmatter.id.trim() : '';
	return configured || relativePath.replace(/\.(md|mdx)$/iu, '').replace(/^\/+|\/+$/gu, '');
}

function runtimeSlug(model: string, relativePath: string, frontmatter: Record<string, unknown>) {
	// Knowledge-page slugs are scoped by their book in frontmatter. The runtime
	// manifest needs a globally addressable collection key, so retain the exact
	// repository path while leaving the page-local slug in the content payload.
	return normalizeSlug(model, relativePath, model === 'docs' ? {} : frontmatter);
}

function assertUniqueEntries(entries: PublishedContentEntry[]) {
	for (const field of ['id', 'slug'] as const) {
		const seen = new Set<string>();
		for (const entry of entries) {
			const identity = `${entry.model}:${entry[field]}`;
			if (seen.has(identity)) throw new Error(`Published content has duplicate ${field} ${identity}.`);
			seen.add(identity);
		}
	}
}

export function buildRuntimePublication(input: {
	files: RuntimePublicationSource[];
	teamId: string;
	generatedAt: string;
	objectRoot: string;
}) {
	const objects: RuntimePublicationObject[] = [];
	const entries: PublishedContentEntry[] = [];

	for (const file of input.files) {
		const identity = sourceIdentity(file.path);
		if (!identity) continue;
		const parsed = parseFrontmatterDocument(file.body);
		const searchText = markdownText(parsed.body);
		const id = entryId(identity.relativePath, parsed.frontmatter);
		const slug = runtimeSlug(identity.model, identity.relativePath, parsed.frontmatter);
		const payload = {
			model: identity.model,
			id,
			slug,
			title: inferTitle(identity.relativePath, parsed.frontmatter),
			summary: inferSummary(parsed.frontmatter, searchText),
			status: inferStatus(parsed.frontmatter),
			visibility: inferVisibility(parsed.frontmatter),
			frontmatter: parsed.frontmatter,
			body: parsed.body,
			relativePath: identity.relativePath,
			updatedAt: input.generatedAt,
		};
		const content = jsonObject(input.objectRoot, `runtime/entries/${identity.model}/${slug}.json`, payload);
		objects.push(content);
		entries.push({
			id,
			model: identity.model,
			slug,
			title: payload.title,
			summary: payload.summary,
			status: payload.status,
			visibility: payload.visibility,
			teamId: input.teamId,
			publishedAt: input.generatedAt,
			updatedAt: input.generatedAt,
			content: contentPointer(content.object),
			metadata: { relativePath: identity.relativePath, ...parsed.frontmatter },
		});
	}

	entries.sort((left, right) => `${left.model}/${left.slug}`.localeCompare(`${right.model}/${right.slug}`));
	assertUniqueEntries(entries);
	const collections: Record<string, PublishedContentObjectPointer> = {};
	for (const model of [...new Set(entries.map((entry) => entry.model))].sort()) {
		const index: PublishedCollectionIndex = {
			model,
			generatedAt: input.generatedAt,
			entries: entries.filter((entry) => entry.model === model),
		};
		index.count = index.entries.length;
		const object = jsonObject(input.objectRoot, `runtime/collections/${model}.json`, index);
		objects.push(object);
		collections[model] = contentPointer(object.object);
	}

	const runtime: PublishedRuntimePointers = {};
	const docsTree = entries.filter((entry) => entry.model === 'docs').map((entry) => ({
		id: entry.id,
		slug: entry.slug,
		title: entry.title,
		summary: entry.summary,
		path: entry.slug.startsWith('knowledge/') ? `/${entry.slug}/` : `/knowledge/${entry.slug}/`,
	}));
	if (docsTree.length > 0) {
		const object = jsonObject(input.objectRoot, 'runtime/docs-tree.json', docsTree);
		objects.push(object);
		runtime.docsTree = contentPointer(object.object);
		runtime.docsHomePath = entries.some((entry) => entry.model === 'books') ? '/books/' : '/knowledge/';
	}
	const search = entries.map((entry) => ({
		id: `${entry.model}:${entry.id}`,
		model: entry.model,
		slug: entry.slug,
		title: entry.title,
		summary: entry.summary,
		updatedAt: entry.updatedAt,
	}));
	if (search.length > 0) {
		const object = jsonObject(input.objectRoot, 'runtime/search-index.json', search);
		objects.push(object);
		runtime.searchIndex = contentPointer(object.object);
	}

	return { entries, collections, runtime, objects };
}

export function verifyRuntimePublicationManifest(body: string, expected: {
	revision: string;
	sourceCommit: string;
	entryCount: number;
}) {
	const raw = JSON.parse(body) as Record<string, unknown>;
	if (raw.contract !== CONTENT_PUBLICATION_CONTRACT) {
		throw new Error(`R2 runtime manifest contract mismatch: expected ${CONTENT_PUBLICATION_CONTRACT}.`);
	}
	const parsed = parsePublishedContentManifest(raw);
	if (parsed.revision !== expected.revision || parsed.sourceCommit !== expected.sourceCommit) {
		throw new Error('R2 runtime manifest provenance verification failed.');
	}
	if (parsed.entries.length !== expected.entryCount) {
		throw new Error(`R2 runtime manifest entry count mismatch: expected ${expected.entryCount}, observed ${parsed.entries.length}.`);
	}
	return parsed;
}
