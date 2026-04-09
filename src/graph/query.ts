import path from 'node:path';
import MiniSearch, { type SearchResult } from 'minisearch';
import type {
	SdkGraphEdge,
	SdkGraphNode,
	SdkGraphPathExplanation,
	SdkGraphQueryOptions,
	SdkGraphSearchOptions,
	SdkGraphSearchResult,
	SdkGraphTraversalResult,
} from '../sdk-types.ts';
import type { GraphBuildState } from './build.ts';
import { normalizeText } from './schema.ts';

type IndexDocument = {
	id: string;
	title: string;
	text: string;
	sourceModel: string;
	nodeType: string;
	path: string;
	tags: string;
	headingPath: string;
	fileId: string;
};

function createIndex(documents: IndexDocument[]) {
	const index = new MiniSearch<IndexDocument>({
		fields: ['title', 'headingPath', 'tags', 'text', 'path', 'sourceModel'],
		storeFields: ['id', 'title', 'sourceModel', 'nodeType', 'path', 'headingPath', 'fileId'],
		searchOptions: {
			boost: { title: 6, headingPath: 4, tags: 3, path: 2, text: 1 },
			prefix: true,
			fuzzy: 0.2,
		},
	});
	index.addAll(documents);
	return index;
}

function matchesNodeOptions(node: SdkGraphNode | undefined, options?: SdkGraphQueryOptions) {
	if (!node) {
		return false;
	}
	if (options?.models?.length && (!node.sourceModel || !options.models.includes(node.sourceModel))) {
		return false;
	}
	if (options?.nodeTypes?.length && !options.nodeTypes.includes(node.nodeType)) {
		return false;
	}
	return true;
}

function dedupeResults(results: SdkGraphSearchResult[]) {
	return [...new Map(results.map((result) => [result.node.id, result])).values()];
}

export class GraphQueryEngine {
	private readonly nodesById = new Map<string, SdkGraphNode>();
	private readonly edgesById = new Map<string, SdkGraphEdge>();
	private readonly outgoing = new Map<string, SdkGraphEdge[]>();
	private readonly incoming = new Map<string, SdkGraphEdge[]>();
	private readonly fileSections = new Map<string, SdkGraphNode[]>();
	private readonly fileIndexDocs: IndexDocument[];
	private readonly sectionIndexDocs: IndexDocument[];
	private readonly entityIndexDocs: IndexDocument[];
	private readonly fileIndex: MiniSearch<IndexDocument>;
	private readonly sectionIndex: MiniSearch<IndexDocument>;
	private readonly entityIndex: MiniSearch<IndexDocument>;

	constructor(
		private readonly state: GraphBuildState,
		private readonly onQuery?: (name: string, detail?: string) => void,
	) {
		for (const node of state.nodes) {
			this.nodesById.set(node.id, node);
			if (node.nodeType === 'Section' && node.fileId) {
				const current = this.fileSections.get(node.fileId) ?? [];
				current.push(node);
				this.fileSections.set(node.fileId, current);
			}
		}
		for (const edge of state.edges) {
			this.edgesById.set(edge.id, edge);
			const outgoing = this.outgoing.get(edge.sourceId) ?? [];
			outgoing.push(edge);
			this.outgoing.set(edge.sourceId, outgoing);
			const incoming = this.incoming.get(edge.targetId) ?? [];
			incoming.push(edge);
			this.incoming.set(edge.targetId, incoming);
		}

		for (const sections of this.fileSections.values()) {
			sections.sort((left, right) => (Number(left.data?.startOffset ?? 0) - Number(right.data?.startOffset ?? 0)));
		}

		this.fileIndexDocs = state.nodes
			.filter((node) => node.nodeType === 'File')
			.map((node) => ({
				id: node.id,
				title: node.title ?? node.slug ?? node.id,
				text: node.text ?? '',
				sourceModel: node.sourceModel ?? '',
				nodeType: node.nodeType,
				path: node.path ?? '',
				tags: (node.tags ?? []).join(' '),
				headingPath: (this.fileSections.get(node.id) ?? []).map((section) => section.headingPath ?? '').join(' '),
				fileId: node.id,
			}));
		this.sectionIndexDocs = state.nodes
			.filter((node) => node.nodeType === 'Section')
			.map((node) => ({
				id: node.id,
				title: node.title ?? node.id,
				text: node.text ?? '',
				sourceModel: node.sourceModel ?? '',
				nodeType: node.nodeType,
				path: node.path ?? '',
				tags: (node.tags ?? []).join(' '),
				headingPath: node.headingPath ?? '',
				fileId: node.fileId ?? '',
			}));
		this.entityIndexDocs = state.nodes
			.filter((node) => !['File', 'Section', 'Tag', 'Series', 'Reference'].includes(node.nodeType))
			.map((node) => ({
				id: node.id,
				title: node.title ?? node.slug ?? node.id,
				text: node.text ?? '',
				sourceModel: node.sourceModel ?? '',
				nodeType: node.nodeType,
				path: node.path ?? '',
				tags: (node.tags ?? []).join(' '),
				headingPath: '',
				fileId: node.fileId ?? '',
			}));

		this.fileIndex = createIndex(this.fileIndexDocs);
		this.sectionIndex = createIndex(this.sectionIndexDocs);
		this.entityIndex = createIndex(this.entityIndexDocs);
	}

	private indexSearch(index: MiniSearch<IndexDocument>, query: string, options?: SdkGraphSearchOptions) {
		if (!query.trim()) {
			return index
				.search(MiniSearch.wildcard, { prefix: options?.prefix ?? true, fuzzy: options?.fuzzy ?? 0.2 })
				.slice(0, options?.limit ?? 20);
		}
		return index.search(query, {
			prefix: options?.prefix ?? true,
			fuzzy: options?.fuzzy ?? 0.2,
		});
	}

	private mapSearchResult(result: SearchResult, reason: string): SdkGraphSearchResult | null {
		const node = this.nodesById.get(String(result.id));
		if (!node) {
			return null;
		}
		return {
			node,
			score: result.score,
			reason,
			highlights: Object.keys(result.match ?? {}),
			context: node.nodeType === 'File'
				? { topSections: (this.fileSections.get(node.id) ?? []).slice(0, 3).map((section) => section.id) }
				: node.nodeType === 'Section'
					? { fileId: node.fileId ?? null }
					: { fileId: node.fileId ?? null },
		};
	}

	private filterSearchResults(results: Array<SdkGraphSearchResult | null>, options?: SdkGraphSearchOptions) {
		return dedupeResults(
			results
				.filter((result): result is SdkGraphSearchResult => Boolean(result))
				.filter((result) => matchesNodeOptions(result.node, options))
				.slice(0, options?.limit ?? 20),
		);
	}

	searchFiles(query: string, options?: SdkGraphSearchOptions) {
		this.onQuery?.('searchFiles', query);
		return this.filterSearchResults(
			this.indexSearch(this.fileIndex, query, options).map((result) => this.mapSearchResult(result, 'file-search')),
			options,
		);
	}

	searchSections(query: string, options?: SdkGraphSearchOptions) {
		this.onQuery?.('searchSections', query);
		return this.filterSearchResults(
			this.indexSearch(this.sectionIndex, query, options).map((result) => this.mapSearchResult(result, 'section-search')),
			options,
		);
	}

	searchEntities(query: string, options?: SdkGraphSearchOptions) {
		this.onQuery?.('searchEntities', query);
		return this.filterSearchResults(
			this.indexSearch(this.entityIndex, query, options).map((result) => this.mapSearchResult(result, 'entity-search')),
			options,
		);
	}

	getNode(id: string) {
		this.onQuery?.('getNode', id);
		return this.nodesById.get(id) ?? null;
	}

	getNeighbors(id: string, options?: SdkGraphQueryOptions) {
		this.onQuery?.('getNeighbors', id);
		const edges = [
			...(options?.direction !== 'incoming' ? this.outgoing.get(id) ?? [] : []),
			...(options?.direction !== 'outgoing' ? this.incoming.get(id) ?? [] : []),
		].filter((edge) => !options?.edgeTypes?.length || options.edgeTypes.includes(edge.type));
		const nodes = dedupeResults(
			edges
				.map((edge) => this.nodesById.get(edge.sourceId === id ? edge.targetId : edge.sourceId))
				.filter((node) => matchesNodeOptions(node, options))
				.map((node) => ({ node: node!, score: 1, reason: 'neighbor' })),
		).map((result) => result.node);
		return {
			node: this.nodesById.get(id) ?? null,
			nodes: nodes.slice(0, options?.limit ?? nodes.length),
			edges: edges.slice(0, options?.limit ?? edges.length),
		};
	}

	followReferences(seedId: string, options?: SdkGraphQueryOptions): SdkGraphTraversalResult {
		this.onQuery?.('followReferences', seedId);
		const maxDepth = options?.depth ?? 2;
		const visited = new Set<string>([seedId]);
		const queue: Array<{ id: string; depth: number }> = [{ id: seedId, depth: 0 }];
		const nodes: SdkGraphNode[] = [];
		const edges: SdkGraphEdge[] = [];

		while (queue.length > 0) {
			const current = queue.shift()!;
			const node = this.nodesById.get(current.id);
			if (node && matchesNodeOptions(node, options)) {
				nodes.push(node);
			}
			if (current.depth >= maxDepth) {
				continue;
			}
			for (const edge of this.outgoing.get(current.id) ?? []) {
				if (options?.edgeTypes?.length && !options.edgeTypes.includes(edge.type)) {
					continue;
				}
				edges.push(edge);
				const target = edge.targetId;
				if (!visited.has(target) && matchesNodeOptions(this.nodesById.get(target), options)) {
					visited.add(target);
					queue.push({ id: target, depth: current.depth + 1 });
				}
			}
		}

		return {
			seedId,
			nodes: dedupeResults(nodes.map((node) => ({ node, score: 1, reason: 'traversal' }))).map((result) => result.node).slice(0, options?.limit ?? nodes.length),
			edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()].slice(0, options?.limit ?? edges.length),
		};
	}

	getBacklinks(id: string, options?: SdkGraphQueryOptions) {
		this.onQuery?.('getBacklinks', id);
		const edges = (this.incoming.get(id) ?? []).filter((edge) => !options?.edgeTypes?.length || options.edgeTypes.includes(edge.type));
		const nodes = edges
			.map((edge) => this.nodesById.get(edge.sourceId))
			.filter((node) => matchesNodeOptions(node, options)) as SdkGraphNode[];
		return {
			node: this.nodesById.get(id) ?? null,
			nodes: nodes.slice(0, options?.limit ?? nodes.length),
			edges: edges.slice(0, options?.limit ?? edges.length),
		};
	}

	getRelated(id: string, options?: SdkGraphQueryOptions) {
		this.onQuery?.('getRelated', id);
		const seed = this.nodesById.get(id);
		if (!seed) {
			return [];
		}
		const scores = new Map<string, number>();
		for (const edge of [...(this.outgoing.get(id) ?? []), ...(this.incoming.get(id) ?? [])]) {
			const otherId = edge.sourceId === id ? edge.targetId : edge.sourceId;
			scores.set(otherId, (scores.get(otherId) ?? 0) + 10);
		}
		for (const node of this.nodesById.values()) {
			if (node.id === id || !matchesNodeOptions(node, options)) continue;
			if (seed.sourceModel && node.sourceModel === seed.sourceModel) {
				scores.set(node.id, (scores.get(node.id) ?? 0) + 2);
			}
			if (seed.path && node.path && path.dirname(seed.path) === path.dirname(node.path)) {
				scores.set(node.id, (scores.get(node.id) ?? 0) + 2);
			}
			const sharedTags = (seed.tags ?? []).filter((tag) => (node.tags ?? []).includes(tag));
			if (sharedTags.length > 0) {
				scores.set(node.id, (scores.get(node.id) ?? 0) + sharedTags.length * 3);
			}
			const lexical = normalizeText(`${seed.title ?? ''} ${seed.text ?? ''}`);
			if (lexical && node.title && lexical.includes(normalizeText(node.title))) {
				scores.set(node.id, (scores.get(node.id) ?? 0) + 1);
			}
		}
		return [...scores.entries()]
			.map(([nodeId, score]) => ({ node: this.nodesById.get(nodeId)!, score, reason: 'related' }))
			.filter((entry) => matchesNodeOptions(entry.node, options))
			.sort((left, right) => right.score - left.score || (left.node.title ?? '').localeCompare(right.node.title ?? ''))
			.slice(0, options?.limit ?? 20);
	}

	getSubgraph(seedIds: string[], options?: SdkGraphQueryOptions): SdkGraphTraversalResult {
		this.onQuery?.('getSubgraph', seedIds.join(','));
		const aggregatedNodes = new Map<string, SdkGraphNode>();
		const aggregatedEdges = new Map<string, SdkGraphEdge>();
		for (const seedId of seedIds) {
			const traversal = this.followReferences(seedId, options);
			for (const node of traversal.nodes) aggregatedNodes.set(node.id, node);
			for (const edge of traversal.edges) aggregatedEdges.set(edge.id, edge);
		}
		return {
			seedId: seedIds.join(','),
			nodes: [...aggregatedNodes.values()],
			edges: [...aggregatedEdges.values()],
		};
	}

	explainReferenceChain(fromId: string, toId: string): SdkGraphPathExplanation | null {
		this.onQuery?.('explainReferenceChain', `${fromId}:${toId}`);
		const queue: Array<{ id: string; path: string[]; edges: string[] }> = [{ id: fromId, path: [fromId], edges: [] }];
		const visited = new Set<string>([fromId]);
		while (queue.length > 0) {
			const current = queue.shift()!;
			if (current.id === toId) {
				return {
					fromId,
					toId,
					nodes: current.path.map((id) => this.nodesById.get(id)).filter((node): node is SdkGraphNode => Boolean(node)),
					edges: current.edges.map((id) => this.edgesById.get(id)).filter((edge): edge is SdkGraphEdge => Boolean(edge)),
				};
			}
			for (const edge of this.outgoing.get(current.id) ?? []) {
				if (visited.has(edge.targetId)) continue;
				visited.add(edge.targetId);
				queue.push({
					id: edge.targetId,
					path: [...current.path, edge.targetId],
					edges: [...current.edges, edge.id],
				});
			}
		}
		return null;
	}

	resolveReference(reference: string, options?: { fromNodeId?: string; fromPath?: string; models?: string[] }) {
		this.onQuery?.('resolveReference', reference);
		const trimmed = reference.trim();
		const [pathPart, hashPart = ''] = trimmed.split('#');
		const directNode = this.nodesById.get(trimmed);
		if (directNode && matchesNodeOptions(directNode, { models: options?.models })) {
			return directNode;
		}
		for (const node of this.nodesById.values()) {
			if (options?.models?.length && (!node.sourceModel || !options.models.includes(node.sourceModel))) continue;
			if (node.nodeType !== 'File' && node.nodeType !== 'Section' && node.nodeType !== 'Entity' && !node.entityType) continue;
			if (node.id === `entity:${pathPart}` || node.slug === pathPart || `${node.sourceModel}/${node.slug}` === pathPart) {
				return node;
			}
			if (node.path && (stripExt(node.path) === stripExt(pathPart) || stripExt(path.relative(process.cwd(), node.path)) === stripExt(pathPart))) {
				if (hashPart) {
					const section = (this.fileSections.get(node.id) ?? []).find((entry) => entry.headingPath === hashPart || entry.slug?.endsWith(`#${hashPart}`));
					if (section) return section;
				}
				return node;
			}
		}
		if (options?.fromNodeId) {
			const source = this.nodesById.get(options.fromNodeId);
			if (source?.path) {
				const absolute = path.resolve(path.dirname(source.path), pathPart);
				for (const node of this.nodesById.values()) {
					if (node.nodeType !== 'File' || !node.path) continue;
					if (stripExt(node.path) === stripExt(absolute)) {
						if (hashPart) {
							const section = (this.fileSections.get(node.id) ?? []).find((entry) => entry.headingPath === hashPart || entry.heading === hashPart);
							if (section) return section;
						}
						return node;
					}
				}
			}
		}
		return null;
	}

	serializeIndexes() {
		return {
			files: { docs: this.fileIndexDocs, index: this.fileIndex.toJSON() },
			sections: { docs: this.sectionIndexDocs, index: this.sectionIndex.toJSON() },
			entities: { docs: this.entityIndexDocs, index: this.entityIndex.toJSON() },
		};
	}
}

function stripExt(value: string) {
	return value.replace(/\.(md|mdx)$/iu, '');
}
