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
import { GRAPH_FRONTMATTER_RELATION_FIELDS, buildSections, extractMarkdownArtifacts, inferSlug, normalizeReferenceValue, readGraphField, stripMarkdownExtension } from './md-node.ts';

export function parseGraphDocument(definition: SdkModelDefinition, filePath: string, source: string): ParsedGraphDocument {
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
	const explicitId = typeof parsed.frontmatter.id === 'string' && parsed.frontmatter.id.trim() ? parsed.frontmatter.id.trim() : null;
	const status = typeof parsed.frontmatter.status === 'string' && parsed.frontmatter.status.trim() ? parsed.frontmatter.status.trim() : null;
	const canonical = parsed.frontmatter.canonical === true;
	const canonicalRef = typeof parsed.frontmatter.canonical === 'string' && parsed.frontmatter.canonical.trim()
		? normalizeReferenceValue(parsed.frontmatter.canonical.trim())
		: null;
	const version = typeof parsed.frontmatter.version === 'string' && parsed.frontmatter.version.trim() ? parsed.frontmatter.version.trim() : null;
	const domain = typeof parsed.frontmatter.domain === 'string' && parsed.frontmatter.domain.trim() ? parsed.frontmatter.domain.trim() : null;
	const audience = ensureArray(parsed.frontmatter.audience);
	const updatedAtValue = readGraphField(definition, parsed.frontmatter, 'updated_at') ?? parsed.frontmatter.updatedAt ?? parsed.frontmatter.updated_at;
	const updatedAt = typeof updatedAtValue === 'string' && updatedAtValue.trim() ? updatedAtValue.trim() : null;
	const body = parsed.body;
	const { headings, links, mdxImports } = extractMarkdownArtifacts(body);
	const sections = graphConfig.enableSections ? buildSections(fileId, body, headings, links) : [];
	const configuredReferences = graphConfig.referenceFields.flatMap((referenceField) => {
		const rawValue = readGraphField(definition, parsed.frontmatter, referenceField.field);
		return ensureArray(rawValue).map((value) => ({
			field: referenceField.field,
			value: normalizeReferenceValue(value),
			targetModels: referenceField.targetModels,
			edgeType: referenceField.edgeType ?? 'REFERENCES',
		}));
	});
	const inferredRelationshipReferences = GRAPH_FRONTMATTER_RELATION_FIELDS.flatMap((entry) =>
		ensureArray(parsed.frontmatter[entry.field]).map((value) => ({
			field: entry.field,
			value: normalizeReferenceValue(value),
			edgeType: entry.edgeType,
		})),
	);
	const canonicalReference = canonicalRef
		? [{ field: 'canonical', value: canonicalRef, edgeType: 'REFERENCES' as const }]
		: [];
	const explicitReferences = [...configuredReferences, ...inferredRelationshipReferences, ...canonicalReference];

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
		explicitId,
		tags,
		series,
		status,
		canonical,
		canonicalRef,
		version,
		domain,
		audience,
		updatedAt,
		sections,
		headings,
		links,
		mdxImports,
		explicitReferences,
	};
}

export function catalogForDocument(document: ParsedGraphDocument, hash: string): GraphFileCatalogEntry {
	return {
		path: document.path,
		relativePath: document.relativePath,
		model: document.model,
		slug: document.slug,
		fileId: document.fileId,
		hash,
	};
}

export function buildReferenceMaps(documents: ParsedGraphDocument[], models: SdkModelRegistry) {
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
