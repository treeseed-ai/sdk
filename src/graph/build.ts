import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';
import { unified } from 'unified';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { parseFrontmatterDocument } from '../frontmatter.ts';
import { resolveModelDefinition } from '../model-registry.ts';
import { readCanonicalFieldValue } from '../sdk-fields.ts';
import type { SdkGraphEdge, SdkGraphNode, SdkModelDefinition, SdkModelRegistry } from '../sdk-types.ts';
import {
	computeEdgeId,
	computeModelSignature,
	createEntityNodeId,
	createFileNodeId,
	emptyGraphMetrics,
	ensureArray,
	graphSnapshotRoot,
	normalizeText,
	resolveGraphModelConfig,
	type GraphDelta,
	type GraphFileCatalogEntry,
	type GraphMetrics,
	type GraphSnapshot,
	type ParsedGraphDocument,
	type ParsedGraphHeading,
	type ParsedGraphLink,
	type ParsedGraphSection,
	GRAPH_SNAPSHOT_VERSION,
	sha1,
} from './schema.ts';

type MdNode = {
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
	delta: GraphDelta;
	snapshotRoot: string;
};

const markdownProcessor = unified().use(remarkParse).use(remarkMdx);

async function walkMarkdownFiles(root: string): Promise<string[]> {
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

function stripMarkdownExtension(value: string) {
	return value.replace(/\.(md|mdx)$/iu, '');
}

function inferSlug(filePath: string, root: string) {
	return stripMarkdownExtension(path.relative(root, filePath).replace(/\\/gu, '/'));
}

function readGraphField(definition: SdkModelDefinition, frontmatter: Record<string, unknown>, field: string) {
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

function walkTree(node: MdNode, visit: (current: MdNode) => void) {
	visit(node);
	for (const child of node.children ?? []) {
		walkTree(child, visit);
	}
}

function extractMarkdownArtifacts(body: string) {
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

function buildSections(fileId: string, body: string, headings: ParsedGraphHeading[], links: ParsedGraphLink[]) {
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

function normalizeReferenceValue(value: string) {
	return value.trim().replace(/^\.\/+/u, '').replace(/\\/gu, '/');
}

function parseGraphDocument(definition: SdkModelDefinition, filePath: string, source: string): ParsedGraphDocument {
	const parsed = parseFrontmatterDocument(source);
	const graphConfig = resolveGraphModelConfig(definition);
	const slug = inferSlug(filePath, definition.contentDir!);
	const fileId = createFileNodeId(definition.name, slug);
	const entityId = createEntityNodeId(definition, slug, parsed.frontmatter);
	const titleValue = readGraphField(definition, parsed.frontmatter, graphConfig.titleField);
	const title = typeof titleValue === 'string' && titleValue.trim() ? titleValue.trim() : slug;
	const tags = graphConfig.tagField ? ensureArray(readGraphField(definition, parsed.frontmatter, graphConfig.tagField)) : [];
	const seriesValue = graphConfig.seriesField ? readGraphField(definition, parsed.frontmatter, graphConfig.seriesField) : undefined;
	const series = typeof seriesValue === 'string' && seriesValue.trim() ? seriesValue.trim() : null;
	const body = parsed.body;
	const { headings, links, mdxImports } = extractMarkdownArtifacts(body);
	const sections = graphConfig.enableSections ? buildSections(fileId, body, headings, links) : [];
	const explicitReferences = graphConfig.referenceFields.flatMap((referenceField) => {
		const rawValue = readGraphField(definition, parsed.frontmatter, referenceField.field);
		return ensureArray(rawValue).map((value) => ({
			field: referenceField.field,
			value: normalizeReferenceValue(value),
			targetModels: referenceField.targetModels,
			edgeType: referenceField.edgeType ?? 'REFERENCES',
		}));
	});

	return {
		fileId,
		entityId,
		model: definition.name,
		entityType: graphConfig.entityType,
		slug,
		title,
		path: filePath,
		relativePath: path.relative(definition.contentDir!, filePath).replace(/\\/gu, '/'),
		dirname: path.dirname(path.relative(definition.contentDir!, filePath).replace(/\\/gu, '/')),
		body,
		normalizedBody: normalizeText(body),
		frontmatter: parsed.frontmatter,
		tags,
		series,
		sections,
		headings,
		links,
		mdxImports,
		explicitReferences,
	};
}

function catalogForDocument(document: ParsedGraphDocument, hash: string): GraphFileCatalogEntry {
	return {
		path: document.path,
		relativePath: document.relativePath,
		model: document.model,
		slug: document.slug,
		fileId: document.fileId,
		hash,
	};
}

function buildReferenceMaps(documents: ParsedGraphDocument[], models: SdkModelRegistry) {
	const entityById = new Map<string, ParsedGraphDocument>();
	const fileById = new Map<string, ParsedGraphDocument>();
	const fileByPath = new Map<string, ParsedGraphDocument>();
	const fileByRelativePath = new Map<string, ParsedGraphDocument>();
	const entityByModelAndSlug = new Map<string, ParsedGraphDocument>();
	const sectionById = new Map<string, ParsedGraphSection>();
	const sectionByAnchor = new Map<string, ParsedGraphSection>();

	for (const document of documents) {
		entityById.set(document.entityId, document);
		fileById.set(document.fileId, document);
		fileByPath.set(path.resolve(document.path), document);
		fileByRelativePath.set(stripMarkdownExtension(document.relativePath), document);
		entityByModelAndSlug.set(`${document.model}:${document.slug}`, document);
		for (const section of document.sections) {
			sectionById.set(section.id, section);
			sectionByAnchor.set(`${document.fileId}#${section.headingSlug}`, section);
			sectionByAnchor.set(`${document.fileId}#${section.headingPath}`, section);
		}
	}

	const resolveReferenceString = (reference: string, sourceDocument?: ParsedGraphDocument) => {
		const trimmed = reference.trim();
		if (!trimmed) {
			return { kind: 'unresolved' as const };
		}

		const [pathPart, hashPart = ''] = trimmed.split('#');
		if (entityById.has(trimmed)) {
			const entity = entityById.get(trimmed)!;
			return { kind: 'entity' as const, targetId: entity.entityId, fileId: entity.fileId };
		}

		if (pathPart.includes('/')) {
			const [modelPrefix, ...slugParts] = pathPart.split('/');
			if (slugParts.length > 0) {
				try {
					const model = resolveModelDefinition(modelPrefix, models).name;
					const slug = slugParts.join('/');
					const target = entityByModelAndSlug.get(`${model}:${slug}`);
					if (target) {
						if (hashPart) {
							const section = sectionByAnchor.get(`${target.fileId}#${hashPart}`);
							if (section) {
								return { kind: 'section' as const, targetId: section.id, fileId: target.fileId };
							}
						}
						return { kind: 'entity' as const, targetId: target.entityId, fileId: target.fileId };
					}
				} catch {
					// Ignore model resolution failures and continue with path-based lookup.
				}
			}
		}

		if (sourceDocument && !pathPart.includes('/')) {
			const sameModel = entityByModelAndSlug.get(`${sourceDocument.model}:${pathPart}`);
			if (sameModel) {
				return { kind: 'entity' as const, targetId: sameModel.entityId, fileId: sameModel.fileId };
			}
		}

		if (sourceDocument && pathPart) {
			const absolute = path.resolve(path.dirname(sourceDocument.path), pathPart);
			const normalized = stripMarkdownExtension(absolute);
			for (const [filePath, document] of fileByPath.entries()) {
				if (stripMarkdownExtension(filePath) === normalized) {
					if (hashPart) {
						const section = sectionByAnchor.get(`${document.fileId}#${hashPart}`);
						if (section) {
							return { kind: 'section' as const, targetId: section.id, fileId: document.fileId };
						}
					}
					return { kind: 'file' as const, targetId: document.fileId, fileId: document.fileId };
				}
			}
		}

		if (pathPart.startsWith('/')) {
			const normalizedRelative = stripMarkdownExtension(pathPart.replace(/^\/+/u, ''));
			const direct = fileByRelativePath.get(normalizedRelative);
			if (direct) {
				if (hashPart) {
					const section = sectionByAnchor.get(`${direct.fileId}#${hashPart}`);
					if (section) {
						return { kind: 'section' as const, targetId: section.id, fileId: direct.fileId };
					}
				}
				return { kind: 'file' as const, targetId: direct.fileId, fileId: direct.fileId };
			}
			for (const document of documents) {
				const routeLike = `${document.model}/${document.slug}`.replace(/^knowledge\//u, 'knowledge/');
				if (routeLike === normalizedRelative || document.slug === normalizedRelative) {
					return { kind: 'file' as const, targetId: document.fileId, fileId: document.fileId };
				}
			}
		}

		if (hashPart && sourceDocument) {
			const section = sectionByAnchor.get(`${sourceDocument.fileId}#${hashPart}`);
			if (section) {
				return { kind: 'section' as const, targetId: section.id, fileId: sourceDocument.fileId };
			}
		}

		return { kind: 'unresolved' as const };
	};

	return {
		entityById,
		fileById,
		fileByPath,
		fileByRelativePath,
		entityByModelAndSlug,
		sectionById,
		sectionByAnchor,
		resolveReferenceString,
	};
}

function buildGraphFromDocuments(
	documents: ParsedGraphDocument[],
	models: SdkModelRegistry,
	priorMetrics?: GraphMetrics,
	delta?: GraphDelta,
) {
	const nodes = new Map<string, SdkGraphNode>();
	const edges = new Map<string, SdkGraphEdge>();
	const referenceNodes = new Map<string, SdkGraphNode>();
	const fileTargets = new Map<string, Set<string>>();
	const maps = buildReferenceMaps(documents, models);

	const addNode = (node: SdkGraphNode) => {
		nodes.set(node.id, node);
	};
	const addEdge = (edge: SdkGraphEdge) => {
		edges.set(edge.id, edge);
		if (['LINKS_TO', 'REFERENCES'].includes(edge.type)) {
			const targets = fileTargets.get(edge.ownerFileId ?? '') ?? new Set<string>();
			targets.add(edge.targetId);
			fileTargets.set(edge.ownerFileId ?? '', targets);
		}
	};
	const unresolvedNodeFor = (ownerFileId: string, value: string) => {
		const id = `reference:${sha1(`${ownerFileId}|${value}`)}`;
		const node = referenceNodes.get(id) ?? {
			id,
			nodeType: 'Reference',
			ownerFileId,
			title: value,
			data: { reference: value, resolved: false },
		};
		referenceNodes.set(id, node);
		addNode(node);
		return node;
	};

	for (const document of documents) {
		addNode({
			id: document.fileId,
			nodeType: 'File',
			sourceModel: document.model,
			ownerFileId: document.fileId,
			path: document.path,
			slug: document.slug,
			title: document.title,
			tags: document.tags,
			series: document.series,
			text: document.body,
			data: { relativePath: document.relativePath },
		});
		addNode({
			id: document.entityId,
			nodeType: document.entityType as SdkGraphNode['nodeType'],
			entityType: document.entityType,
			sourceModel: document.model,
			ownerFileId: document.fileId,
			path: document.path,
			slug: document.slug,
			title: document.title,
			tags: document.tags,
			series: document.series,
			fileId: document.fileId,
			text: document.body,
			data: { frontmatter: document.frontmatter },
		});
		addEdge({
			id: computeEdgeId(document.fileId, 'DEFINES', document.entityId, document.fileId),
			type: 'DEFINES',
			sourceId: document.fileId,
			targetId: document.entityId,
			ownerFileId: document.fileId,
		});
		addEdge({
			id: computeEdgeId(document.entityId, 'DEFINED_BY', document.fileId, document.fileId),
			type: 'DEFINED_BY',
			sourceId: document.entityId,
			targetId: document.fileId,
			ownerFileId: document.fileId,
		});

		for (const [index, section] of document.sections.entries()) {
			addNode({
				id: section.id,
				nodeType: 'Section',
				sourceModel: document.model,
				ownerFileId: document.fileId,
				path: document.path,
				fileId: document.fileId,
				entityId: document.entityId,
				slug: `${document.slug}#${section.headingSlug}`,
				title: section.heading ?? document.title,
				heading: section.heading,
				headingPath: section.headingPath,
				level: section.level,
				tags: document.tags,
				text: section.rawText,
				data: { ordinal: section.ordinal, startOffset: section.startOffset, endOffset: section.endOffset },
			});
			addEdge({
				id: computeEdgeId(document.fileId, 'HAS_SECTION', section.id, `${document.fileId}:${section.id}`),
				type: 'HAS_SECTION',
				sourceId: document.fileId,
				targetId: section.id,
				ownerFileId: document.fileId,
			});
			addEdge({
				id: computeEdgeId(section.id, 'BELONGS_TO_FILE', document.fileId, `${section.id}:${document.fileId}`),
				type: 'BELONGS_TO_FILE',
				sourceId: section.id,
				targetId: document.fileId,
				ownerFileId: document.fileId,
			});
			if (index > 0) {
				const previous = document.sections[index - 1]!;
				addEdge({
					id: computeEdgeId(previous.id, 'NEXT_SECTION', section.id, `${previous.id}:${section.id}`),
					type: 'NEXT_SECTION',
					sourceId: previous.id,
					targetId: section.id,
					ownerFileId: document.fileId,
				});
				addEdge({
					id: computeEdgeId(section.id, 'PREV_SECTION', previous.id, `${section.id}:${previous.id}`),
					type: 'PREV_SECTION',
					sourceId: section.id,
					targetId: previous.id,
					ownerFileId: document.fileId,
				});
			}
		}

		const stack: ParsedGraphSection[] = [];
		for (const section of document.sections) {
			if (section.level <= 0) {
				continue;
			}
			while ((stack.at(-1)?.level ?? 0) >= section.level) {
				stack.pop();
			}
			const parent = stack.at(-1);
			if (parent) {
				addEdge({
					id: computeEdgeId(section.id, 'PARENT_SECTION', parent.id, `${section.id}:${parent.id}`),
					type: 'PARENT_SECTION',
					sourceId: section.id,
					targetId: parent.id,
					ownerFileId: document.fileId,
				});
				addEdge({
					id: computeEdgeId(parent.id, 'CHILD_SECTION', section.id, `${parent.id}:${section.id}`),
					type: 'CHILD_SECTION',
					sourceId: parent.id,
					targetId: section.id,
					ownerFileId: document.fileId,
				});
			}
			stack.push(section);
		}

		for (const tag of document.tags) {
			const tagId = `tag:${normalizeText(tag)}`;
			addNode({
				id: tagId,
				nodeType: 'Tag',
				title: tag,
				slug: normalizeText(tag),
			});
			for (const sourceId of [document.fileId, document.entityId]) {
				addEdge({
					id: computeEdgeId(sourceId, 'HAS_TAG', tagId, `${sourceId}:${tagId}`),
					type: 'HAS_TAG',
					sourceId,
					targetId: tagId,
					ownerFileId: document.fileId,
				});
			}
		}

		if (document.series) {
			const seriesId = `series:${normalizeText(document.series)}`;
			addNode({
				id: seriesId,
				nodeType: 'Series',
				title: document.series,
				slug: normalizeText(document.series),
			});
			for (const sourceId of [document.fileId, document.entityId]) {
				addEdge({
					id: computeEdgeId(sourceId, 'IN_SERIES', seriesId, `${sourceId}:${seriesId}`),
					type: 'IN_SERIES',
					sourceId,
					targetId: seriesId,
					ownerFileId: document.fileId,
				});
			}
		}

		for (const reference of document.explicitReferences) {
			const resolved = maps.resolveReferenceString(reference.value, document);
			const targetId =
				resolved.kind === 'unresolved'
					? unresolvedNodeFor(document.fileId, reference.value).id
					: resolved.targetId;
			for (const sourceId of [document.entityId, document.fileId]) {
				addEdge({
					id: computeEdgeId(sourceId, reference.edgeType, targetId, `${reference.field}:${reference.value}:${sourceId}`),
					type: reference.edgeType,
					sourceId,
					targetId,
					ownerFileId: document.fileId,
					data: { field: reference.field, value: reference.value },
				});
			}
		}

		for (const section of document.sections) {
			for (const link of [...section.outboundLinks, ...document.mdxImports.map((entry) => ({
				url: entry,
				text: entry,
				startOffset: section.startOffset,
				endOffset: section.startOffset,
			}))]) {
				const resolved = maps.resolveReferenceString(link.url, document);
				const targetId =
					resolved.kind === 'unresolved'
						? unresolvedNodeFor(document.fileId, link.url).id
						: resolved.targetId;
				addEdge({
					id: computeEdgeId(section.id, 'LINKS_TO', targetId, `${section.id}:${link.url}`),
					type: 'LINKS_TO',
					sourceId: section.id,
					targetId,
					ownerFileId: document.fileId,
					data: { url: link.url, text: link.text },
				});
				if (resolved.kind === 'entity' || resolved.kind === 'section') {
					section.referencedEntityIds.push(targetId);
				}
			}
		}
	}

	for (const document of documents) {
		const candidateTargetIds = [...(fileTargets.get(document.fileId) ?? new Set<string>())];
		for (const section of document.sections) {
			const text = normalizeText(section.rawText);
			for (const targetId of candidateTargetIds) {
				if (edges.has(computeEdgeId(section.id, 'LINKS_TO', targetId, `${section.id}:${targetId}`))
					|| edges.has(computeEdgeId(section.id, 'REFERENCES', targetId, `${section.id}:${targetId}`))) {
					continue;
				}
				const target = nodes.get(targetId);
				if (!target?.title) {
					continue;
				}
				const variants = [target.title, target.slug ?? ''].map((entry) => normalizeText(entry)).filter((entry) => entry.length >= 4);
				if (variants.some((variant) => variant && text.includes(variant))) {
					addEdge({
						id: computeEdgeId(section.id, 'MENTIONS', targetId, `${section.id}:${targetId}`),
						type: 'MENTIONS',
						sourceId: section.id,
						targetId,
						ownerFileId: document.fileId,
					});
				}
			}
		}
	}

	const groupBy = <TKey extends string>(items: ParsedGraphDocument[], fn: (document: ParsedGraphDocument) => TKey | null) => {
		const grouped = new Map<TKey, ParsedGraphDocument[]>();
		for (const document of items) {
			const key = fn(document);
			if (!key) continue;
			const bucket = grouped.get(key) ?? [];
			bucket.push(document);
			grouped.set(key, bucket);
		}
		return grouped;
	};

	for (const [, group] of groupBy(documents, (document) => document.model)) {
		for (let i = 0; i < group.length; i += 1) {
			for (let j = i + 1; j < group.length; j += 1) {
				for (const [leftId, rightId] of [
					[group[i]!.fileId, group[j]!.fileId],
					[group[i]!.entityId, group[j]!.entityId],
				] as const) {
					addEdge({
						id: computeEdgeId(leftId, 'SAME_COLLECTION', rightId, `${leftId}:${rightId}`),
						type: 'SAME_COLLECTION',
						sourceId: leftId,
						targetId: rightId,
						ownerFileId: group[i]!.fileId,
					});
					addEdge({
						id: computeEdgeId(rightId, 'SAME_COLLECTION', leftId, `${rightId}:${leftId}`),
						type: 'SAME_COLLECTION',
						sourceId: rightId,
						targetId: leftId,
						ownerFileId: group[j]!.fileId,
					});
				}
			}
		}
	}

	for (const [, group] of groupBy(documents, (document) => (document.dirname && document.dirname !== '.' ? document.dirname : null))) {
		for (let i = 0; i < group.length; i += 1) {
			for (let j = i + 1; j < group.length; j += 1) {
				for (const [leftId, rightId] of [
					[group[i]!.fileId, group[j]!.fileId],
					[group[i]!.entityId, group[j]!.entityId],
				] as const) {
					addEdge({
						id: computeEdgeId(leftId, 'SAME_DIRECTORY', rightId, `${leftId}:${rightId}`),
						type: 'SAME_DIRECTORY',
						sourceId: leftId,
						targetId: rightId,
						ownerFileId: group[i]!.fileId,
					});
					addEdge({
						id: computeEdgeId(rightId, 'SAME_DIRECTORY', leftId, `${rightId}:${leftId}`),
						type: 'SAME_DIRECTORY',
						sourceId: rightId,
						targetId: leftId,
						ownerFileId: group[j]!.fileId,
					});
				}
			}
		}
	}

	const metrics: GraphMetrics = {
		...(priorMetrics ?? emptyGraphMetrics()),
		totalFiles: documents.length,
		totalSections: documents.reduce((sum, document) => sum + document.sections.length, 0),
		totalEntities: documents.length,
		totalEdges: edges.size,
		unresolvedReferences: [...nodes.values()].filter((node) => node.nodeType === 'Reference').length,
		lastRefreshAt: new Date().toISOString(),
	};

	return {
		nodes: [...nodes.values()],
		edges: [...edges.values()],
		metrics,
		delta: delta ?? { added: [], modified: [], removed: [] },
	};
}

async function readSnapshotFile<T>(filePath: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(filePath, 'utf8')) as T;
	} catch {
		return null;
	}
}

export async function loadGraphSnapshot(repoRoot: string, models: SdkModelRegistry): Promise<GraphBuildState | null> {
	const snapshotRoot = graphSnapshotRoot(repoRoot);
	const graph = await readSnapshotFile<Pick<GraphSnapshot, 'version' | 'modelSignature' | 'documents' | 'nodes' | 'edges'>>(
		path.join(snapshotRoot, 'graph.json'),
	);
	const catalog = await readSnapshotFile<Pick<GraphSnapshot, 'catalog'>>(path.join(snapshotRoot, 'catalog.json'));
	const metrics = await readSnapshotFile<GraphMetrics>(path.join(snapshotRoot, 'metrics.json'));
	const delta = await readSnapshotFile<GraphDelta>(path.join(snapshotRoot, 'deltas.json'));
	const currentSignature = computeModelSignature(models);

	if (!graph || graph.version !== GRAPH_SNAPSHOT_VERSION || graph.modelSignature !== currentSignature || !catalog) {
		return null;
	}

	return {
		modelSignature: graph.modelSignature,
		documents: graph.documents,
		nodes: graph.nodes,
		edges: graph.edges,
		catalog: catalog.catalog,
		metrics: metrics ?? emptyGraphMetrics(),
		delta: delta ?? { added: [], modified: [], removed: [] },
		snapshotRoot,
	};
}

export async function saveGraphSnapshot(state: GraphBuildState) {
	await mkdir(state.snapshotRoot, { recursive: true });
	const graphPayload: Pick<GraphSnapshot, 'version' | 'modelSignature' | 'documents' | 'nodes' | 'edges'> = {
		version: GRAPH_SNAPSHOT_VERSION,
		modelSignature: state.modelSignature,
		documents: state.documents,
		nodes: state.nodes,
		edges: state.edges,
	};
	await Promise.all([
		writeFile(path.join(state.snapshotRoot, 'graph.json'), `${JSON.stringify(graphPayload, null, 2)}\n`, 'utf8'),
		writeFile(path.join(state.snapshotRoot, 'catalog.json'), `${JSON.stringify({ catalog: state.catalog }, null, 2)}\n`, 'utf8'),
		writeFile(path.join(state.snapshotRoot, 'metrics.json'), `${JSON.stringify(state.metrics, null, 2)}\n`, 'utf8'),
		writeFile(path.join(state.snapshotRoot, 'deltas.json'), `${JSON.stringify(state.delta, null, 2)}\n`, 'utf8'),
		writeFile(
			path.join(state.snapshotRoot, 'indexes.json'),
			`${JSON.stringify({ files: [], sections: [], entities: [] }, null, 2)}\n`,
			'utf8',
		),
	]);
}

async function hashFile(filePath: string) {
	const source = await readFile(filePath, 'utf8');
	return {
		source,
		hash: sha1(source),
	};
}

function contentDefinitions(models: SdkModelRegistry) {
	return Object.values(models)
		.filter((definition): definition is SdkModelDefinition & { contentDir: string } => definition.storage === 'content' && Boolean(definition.contentDir))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export async function refreshGraphBuildState(
	repoRoot: string,
	models: SdkModelRegistry,
	request?: { paths?: string[] },
	priorState?: GraphBuildState | null,
): Promise<GraphBuildState> {
	const snapshotRoot = graphSnapshotRoot(repoRoot);
	const modelSignature = computeModelSignature(models);
	const priorDocuments = new Map((priorState?.documents ?? []).map((document) => [document.fileId, document]));
	const priorCatalog = new Map((priorState?.catalog ?? []).map((entry) => [path.resolve(entry.path), entry]));
	const nextDocuments = new Map(priorDocuments);
	const nextCatalog = new Map(priorCatalog);
	const requestedPaths = request?.paths?.map((entry) => path.resolve(repoRoot, entry)).filter(Boolean);

	const changed: GraphDelta = { added: [], modified: [], removed: [] };
	const trackedPaths = new Set<string>();
	const definitions = contentDefinitions(models);

	if (requestedPaths && requestedPaths.length > 0) {
		for (const requestedPath of requestedPaths) {
			const matchingDefinition = definitions.find((definition) => requestedPath.startsWith(path.resolve(definition.contentDir)));
			if (!matchingDefinition) {
				continue;
			}
			trackedPaths.add(requestedPath);
			try {
				const fileStats = await stat(requestedPath);
				if (!fileStats.isFile()) continue;
				const { source, hash } = await hashFile(requestedPath);
				const parsed = parseGraphDocument(matchingDefinition, requestedPath, source);
				const existing = priorCatalog.get(requestedPath);
				nextDocuments.set(parsed.fileId, parsed);
				nextCatalog.set(requestedPath, catalogForDocument(parsed, hash));
				if (!existing) {
					changed.added.push(parsed.fileId);
				} else if (existing.hash !== hash) {
					changed.modified.push(parsed.fileId);
				}
			} catch {
				const existing = priorCatalog.get(requestedPath);
				if (existing) {
					changed.removed.push(existing.fileId);
					nextCatalog.delete(requestedPath);
					nextDocuments.delete(existing.fileId);
				}
			}
		}
	} else {
		for (const definition of definitions) {
			const files = await walkMarkdownFiles(definition.contentDir);
			for (const filePath of files) {
				const resolvedPath = path.resolve(filePath);
				trackedPaths.add(resolvedPath);
				const { source, hash } = await hashFile(resolvedPath);
				const parsed = parseGraphDocument(definition, resolvedPath, source);
				const existing = priorCatalog.get(resolvedPath);
				nextDocuments.set(parsed.fileId, parsed);
				nextCatalog.set(resolvedPath, catalogForDocument(parsed, hash));
				if (!existing) {
					changed.added.push(parsed.fileId);
				} else if (existing.hash !== hash) {
					changed.modified.push(parsed.fileId);
				}
			}
		}
		for (const [existingPath, existing] of priorCatalog.entries()) {
			if (!trackedPaths.has(existingPath)) {
				changed.removed.push(existing.fileId);
				nextCatalog.delete(existingPath);
				nextDocuments.delete(existing.fileId);
			}
		}
	}

	const built = buildGraphFromDocuments(
		[...nextDocuments.values()].sort((left, right) => left.fileId.localeCompare(right.fileId)),
		models,
		priorState?.metrics,
		changed,
	);

	return {
		modelSignature,
		documents: [...nextDocuments.values()].sort((left, right) => left.fileId.localeCompare(right.fileId)),
		nodes: built.nodes,
		edges: built.edges,
		catalog: [...nextCatalog.values()].sort((left, right) => left.fileId.localeCompare(right.fileId)),
		metrics: built.metrics,
		delta: changed,
		snapshotRoot,
	};
}

export async function clearGraphSnapshot(repoRoot: string) {
	await rm(graphSnapshotRoot(repoRoot), { recursive: true, force: true });
}
