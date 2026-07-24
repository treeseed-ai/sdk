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
import { buildReferenceMaps } from './parse-graph-document.ts';

export function buildGraphFromDocuments(
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
	const validation: GraphValidation = emptyGraphValidation();
	const seenExplicitIds = new Set<string>();

	for (const document of documents) {
		if (!document.explicitId) {
			validation.missingIds.push(document.fileId);
		} else if (seenExplicitIds.has(document.explicitId)) {
			validation.duplicateIds.push(document.explicitId);
		} else {
			seenExplicitIds.add(document.explicitId);
		}
	}

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
			status: document.status,
			canonical: document.canonical,
			canonicalId: document.canonicalRef,
			version: document.version,
			domain: document.domain,
			audience: document.audience,
			updatedAt: document.updatedAt,
			text: document.body,
			data: { relativePath: document.relativePath, explicitId: document.explicitId, frontmatter: document.frontmatter },
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
			status: document.status,
			canonical: document.canonical,
			canonicalId: document.canonicalRef,
			version: document.version,
			domain: document.domain,
			audience: document.audience,
			updatedAt: document.updatedAt,
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
				status: document.status,
				canonical: document.canonical,
				canonicalId: document.canonicalRef,
				version: document.version,
				domain: document.domain,
				audience: document.audience,
				updatedAt: document.updatedAt,
				text: section.rawText,
				data: {
					ordinal: section.ordinal,
					startOffset: section.startOffset,
					endOffset: section.endOffset,
					textLength: section.rawText.length,
					linkDensity: section.outboundLinks.length,
					ownerTitle: document.title,
				},
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
			if (!AUTHORED_GRAPH_EDGE_TYPES.includes(reference.edgeType)) {
				validation.invalidEdgeTypes.push({ ownerFileId: document.fileId, field: reference.field, edgeType: reference.edgeType });
				continue;
			}
			const resolved = maps.resolveReferenceString(reference.value, document);
			const targetId =
				resolved.kind === 'unresolved'
					? unresolvedNodeFor(document.fileId, reference.value).id
					: resolved.targetId;
			if (resolved.kind === 'unresolved') {
				validation.brokenReferences.push({ ownerFileId: document.fileId, value: reference.value, edgeType: reference.edgeType });
			}
			if (reference.field === 'canonical' && (resolved.kind === 'unresolved' || resolved.targetId === document.entityId || resolved.targetId === document.fileId)) {
				validation.invalidCanonicalRefs.push({ ownerFileId: document.fileId, value: reference.value });
			}
			if (reference.edgeType === 'SUPERSEDES' && resolved.kind === 'unresolved') {
				validation.invalidSupersedesRefs.push({ ownerFileId: document.fileId, value: reference.value });
			}
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
		validation: {
			missingIds: validation.missingIds.length,
			duplicateIds: validation.duplicateIds.length,
			brokenReferences: validation.brokenReferences.length,
			invalidEdgeTypes: validation.invalidEdgeTypes.length,
			invalidCanonicalRefs: validation.invalidCanonicalRefs.length,
			invalidSupersedesRefs: validation.invalidSupersedesRefs.length,
		},
		lastRefreshAt: new Date().toISOString(),
	};

	return {
		nodes: [...nodes.values()],
		edges: [...edges.values()],
		metrics,
		validation,
		delta: delta ?? { added: [], modified: [], removed: [] },
	};
}
