import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';
import { unified } from 'unified';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { parseFrontmatterDocument } from '../../content/frontmatter.ts';
import { resolveModelDefinition } from '../../entrypoints/models/model-registry.ts';
import { readCanonicalFieldValue } from '../../entrypoints/models/sdk-fields.ts';
import type { SdkGraphEdge, SdkGraphNode, SdkModelDefinition, SdkModelRegistry } from '../../entrypoints/models/sdk-types.ts';
import {
	AUTHORED_GRAPH_EDGE_TYPES,
	computeEdgeId,
	computeModelSignature,
	createEntityNodeId,
	createFileNodeId,
	emptyGraphMetrics,
	emptyGraphValidation,
	ensureArray,
	graphSnapshotRoot,
	normalizeText,
	resolveGraphModelConfig,
	type AuthoredGraphEdgeType,
	type GraphDelta,
	type GraphFileCatalogEntry,
	type GraphMetrics,
	type GraphSnapshot,
	type GraphValidation,
	type ParsedGraphDocument,
	type ParsedGraphHeading,
	type ParsedGraphLink,
	type ParsedGraphSection,
	GRAPH_SNAPSHOT_VERSION,
	sha1,
} from '../schema.ts';


export type MdNode = {
	type?: string;
	url?: string;
	value?: string;
	children?: MdNode[];
	position?: {
		start?: { offset?: number };
		end?: { offset?: number };
	};
	depth?: number;
};

export type GraphBuildState = {
	modelSignature: string;
	documents: ParsedGraphDocument[];
	nodes: SdkGraphNode[];
	edges: SdkGraphEdge[];
	catalog: GraphFileCatalogEntry[];
	metrics: GraphMetrics;
	validation: GraphValidation;
	delta: GraphDelta;
	snapshotRoot: string;
};

export const markdownProcessor = unified().use(remarkParse).use(remarkMdx);

export async function walkMarkdownFiles(root: string): Promise<string[]> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		const children = await Promise.all(entries.map(async (entry) => {
			const fullPath = path.join(root, entry.name);
			if (entry.isDirectory()) {
				return walkMarkdownFiles(fullPath);
			}
			if (entry.isFile() && /\.(md|mdx)$/iu.test(entry.name)) {
				return [fullPath];
			}
			return [];
		}));
		return children.flat();
	} catch {
		return [];
	}
}

export function stripMarkdownExtension(value: string) {
	return value.replace(/\.(md|mdx)$/iu, '');
}

export function inferSlug(filePath: string, root: string) {
	return stripMarkdownExtension(path.relative(root, filePath).replace(/\\/gu, '/'));
}

export function readGraphField(definition: SdkModelDefinition, frontmatter: Record<string, unknown>, field: string) {
	const binding = definition.fields[field];
	if (binding) {
		const value = readCanonicalFieldValue(definition, { frontmatter }, field);
		if (value !== undefined) {
			return value;
		}
	}

	const keys = new Set<string>([field]);
	if (binding) {
		for (const alias of binding.aliases ?? []) keys.add(alias);
		for (const key of binding.contentKeys ?? []) keys.add(key);
	}
	for (const key of keys) {
		if (key in frontmatter) {
			return frontmatter[key];
		}
	}
	return undefined;
}

export function walkTree(node: MdNode, visit: (current: MdNode) => void) {
	visit(node);
	for (const child of node.children ?? []) {
		walkTree(child, visit);
	}
}

export function extractMarkdownArtifacts(body: string) {
	const tree = markdownProcessor.parse(body) as MdNode;
	const slugger = new GithubSlugger();
	const headings: ParsedGraphHeading[] = [];
	const links: ParsedGraphLink[] = [];
	const mdxImports: string[] = [];

	walkTree(tree, (node) => {
		const startOffset = node.position?.start?.offset ?? 0;
		const endOffset = node.position?.end?.offset ?? startOffset;
		if (node.type === 'heading' && typeof node.depth === 'number') {
			headings.push({
				text: toString(node as never).trim(),
				slug: slugger.slug(toString(node as never).trim() || 'section'),
				level: node.depth,
				startOffset,
				endOffset,
			});
		}
		if (node.type === 'link' && typeof node.url === 'string') {
			links.push({
				url: node.url,
				text: toString(node as never).trim(),
				startOffset,
				endOffset,
			});
		}
		if (node.type === 'mdxjsEsm' && typeof node.value === 'string') {
			const matches = node.value.matchAll(/(?:import|export)\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/gu);
			for (const match of matches) {
				if (match[1]) {
					mdxImports.push(match[1]);
				}
			}
		}
	});

	return { headings, links, mdxImports };
}

export function buildSections(fileId: string, body: string, headings: ParsedGraphHeading[], links: ParsedGraphLink[]) {
	const sections: ParsedGraphSection[] = [];
	const lines = body.length;
	const nonWhitespace = /\S/u.test(body);
	const headingOrdinals = new Map<string, number>();
	const headingPathStack: Array<{ level: number; path: string }> = [];

	const sectionEndForHeading = (index: number) => {
		const current = headings[index];
		for (let pointer = index + 1; pointer < headings.length; pointer += 1) {
			if (headings[pointer].level <= current.level) {
				return headings[pointer].startOffset;
			}
		}
		return lines;
	};

	if (headings.length === 0) {
		if (!nonWhitespace) {
			return sections;
		}
		sections.push({
			id: `section:${fileId}:__intro:0`,
			fileId,
			heading: null,
			headingSlug: '__intro',
			headingPath: '__intro',
			level: 0,
			ordinal: 0,
			startOffset: 0,
			endOffset: lines,
			rawText: body,
			normalizedText: normalizeText(body),
			outboundLinks: links,
			referencedEntityIds: [],
		});
		return sections;
	}

	const introEnd = headings[0]?.startOffset ?? 0;
	if (introEnd > 0 && /\S/u.test(body.slice(0, introEnd))) {
		sections.push({
			id: `section:${fileId}:__intro:0`,
			fileId,
			heading: null,
			headingSlug: '__intro',
			headingPath: '__intro',
			level: 0,
			ordinal: 0,
			startOffset: 0,
			endOffset: introEnd,
			rawText: body.slice(0, introEnd),
			normalizedText: normalizeText(body.slice(0, introEnd)),
			outboundLinks: links.filter((link) => link.startOffset >= 0 && link.startOffset < introEnd),
			referencedEntityIds: [],
		});
	}

	for (let index = 0; index < headings.length; index += 1) {
		const heading = headings[index];
		while ((headingPathStack.at(-1)?.level ?? 0) >= heading.level) {
			headingPathStack.pop();
		}
		const parentPath = headingPathStack.at(-1)?.path;
		const headingPath = parentPath ? `${parentPath}/${heading.slug}` : heading.slug;
		headingPathStack.push({ level: heading.level, path: headingPath });
		const ordinal = headingOrdinals.get(headingPath) ?? 0;
		headingOrdinals.set(headingPath, ordinal + 1);
		const endOffset = sectionEndForHeading(index);
		const rawText = body.slice(heading.startOffset, endOffset);
		sections.push({
			id: `section:${fileId}:${headingPath}:${ordinal}`,
			fileId,
			heading: heading.text,
			headingSlug: heading.slug,
			headingPath,
			level: heading.level,
			ordinal,
			startOffset: heading.startOffset,
			endOffset,
			rawText,
			normalizedText: normalizeText(rawText),
			outboundLinks: links.filter((link) => link.startOffset >= heading.startOffset && link.startOffset < endOffset),
			referencedEntityIds: [],
		});
	}

	return sections;
}

export function normalizeReferenceValue(value: string) {
	return value.trim().replace(/^\.\/+/u, '').replace(/\\/gu, '/');
}

export const GRAPH_FRONTMATTER_RELATION_FIELDS: Array<{ field: string; edgeType: AuthoredGraphEdgeType; multiple?: boolean }> = [
	{ field: 'related', edgeType: 'RELATES_TO', multiple: true },
	{ field: 'references', edgeType: 'REFERENCES', multiple: true },
	{ field: 'dependsOn', edgeType: 'DEPENDS_ON', multiple: true },
	{ field: 'implements', edgeType: 'IMPLEMENTS', multiple: true },
	{ field: 'extends', edgeType: 'EXTENDS', multiple: true },
	{ field: 'supersedes', edgeType: 'SUPERSEDES', multiple: true },
	{ field: 'belongsTo', edgeType: 'BELONGS_TO', multiple: true },
	{ field: 'about', edgeType: 'ABOUT', multiple: true },
	{ field: 'usedBy', edgeType: 'USED_BY', multiple: true },
	{ field: 'generatedFrom', edgeType: 'GENERATED_FROM', multiple: true },
];
