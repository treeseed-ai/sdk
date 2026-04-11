import path from 'node:path';
import type {
	SdkContextPack,
	SdkContextPackRequest,
	SdkGraphDslRelation,
	SdkGraphEdge,
	SdkGraphEdgeType,
	SdkGraphNode,
	SdkGraphQueryOptions,
	SdkGraphQueryRequest,
	SdkGraphQueryResult,
	SdkGraphQueryView,
	SdkGraphPathExplanation,
	SdkGraphRankingProvider,
	SdkGraphSearchOptions,
	SdkGraphSearchResult,
	SdkGraphSeed,
	SdkGraphSeedResolution,
	SdkGraphTraversalResult,
	SdkGraphWhereFilter,
} from '../sdk-types.ts';
import type { GraphBuildState } from './build.ts';
import { parseGraphDsl } from './dsl.ts';
import { DEFAULT_GRAPH_RANKING_PROVIDER } from './ranking.ts';
import { normalizeText } from './schema.ts';

const RELATION_TO_EDGE_TYPE: Record<SdkGraphDslRelation, SdkGraphEdgeType> = {
	related: 'RELATES_TO',
	depends_on: 'DEPENDS_ON',
	implements: 'IMPLEMENTS',
	references: 'REFERENCES',
	parent: 'PARENT_SECTION',
	child: 'CHILD_SECTION',
	supersedes: 'SUPERSEDES',
};

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

function tokenEstimate(text: string) {
	return Math.max(1, Math.ceil(text.trim().length / 4));
}

function normalizeScopePath(value: string) {
	return value.replace(/\\/gu, '/').replace(/\/+/gu, '/').replace(/\/$/u, '') || '/';
}

function stripExt(value: string) {
	return value.replace(/\.(md|mdx)$/iu, '');
}

function nodeContentPath(node: SdkGraphNode) {
	const relativePath = typeof node.data?.relativePath === 'string'
		? node.data.relativePath.replace(/\.(md|mdx)$/iu, '')
		: typeof node.slug === 'string'
			? node.slug.replace(/#.*$/u, '')
			: '';
	const modelPrefix = node.sourceModel ? `/${node.sourceModel}` : '';
	if (!relativePath && modelPrefix) {
		return modelPrefix;
	}
	return normalizeScopePath(`${modelPrefix}/${relativePath}`);
}

function nodeMatchesScope(node: SdkGraphNode, scopePaths?: string[]) {
	if (!scopePaths?.length) {
		return true;
	}
	const contentPath = nodeContentPath(node);
	return scopePaths.some((scopePath) => contentPath === normalizeScopePath(scopePath) || contentPath.startsWith(`${normalizeScopePath(scopePath)}/`));
}

function nodeMetadataType(node: SdkGraphNode) {
	const frontmatter = node.data?.frontmatter as Record<string, unknown> | undefined;
	const frontmatterType = typeof frontmatter?.type === 'string' ? frontmatter.type : null;
	return normalizeText(frontmatterType ?? node.entityType ?? node.sourceModel ?? node.nodeType);
}

function nodeMatchesWhere(node: SdkGraphNode, filters?: SdkGraphWhereFilter[]) {
	if (!filters?.length) {
		return true;
	}
	return filters.every((filter) => {
		const values =
			filter.field === 'type'
				? [nodeMetadataType(node)]
				: filter.field === 'status'
					? [normalizeText(node.status ?? '')]
					: filter.field === 'audience'
						? (node.audience ?? []).map(normalizeText)
						: filter.field === 'tag'
							? (node.tags ?? []).map(normalizeText)
							: filter.field === 'domain'
								? [normalizeText(node.domain ?? '')]
								: [];
		const expected = Array.isArray(filter.value) ? filter.value.map(normalizeText) : [normalizeText(filter.value)];
		return filter.op === 'eq'
			? expected.some((entry) => values.includes(entry))
			: expected.every((entry) => values.includes(entry));
	});
}

function excerptForView(node: SdkGraphNode, view: SdkGraphQueryView) {
	const text = node.text ?? '';
	switch (view) {
		case 'list':
			return '';
		case 'map':
			return `${node.title ?? node.id}`;
		case 'brief':
			return text.slice(0, 480).trim();
		case 'full':
		default:
			return text;
	}
}

export class GraphQueryEngine {
	private readonly nodesById = new Map<string, SdkGraphNode>();
	private readonly edgesById = new Map<string, SdkGraphEdge>();
	private readonly outgoing = new Map<string, SdkGraphEdge[]>();
	private readonly incoming = new Map<string, SdkGraphEdge[]>();
	private readonly fileSections = new Map<string, SdkGraphNode[]>();
	private readonly rankingProvider: SdkGraphRankingProvider;
	private readonly rankingIndex;

	constructor(
		private readonly state: GraphBuildState,
		private readonly onQuery?: (name: string, detail?: string) => void,
		rankingProvider: SdkGraphRankingProvider = DEFAULT_GRAPH_RANKING_PROVIDER,
	) {
		this.rankingProvider = rankingProvider;
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
			sections.sort((left, right) => Number(left.data?.startOffset ?? 0) - Number(right.data?.startOffset ?? 0));
		}
		this.rankingIndex = this.rankingProvider.buildIndex({
			nodes: state.nodes,
			edges: state.edges,
		});
	}

	private filterSearchResults(results: SdkGraphSearchResult[], options?: SdkGraphSearchOptions) {
		return dedupeResults(
			results
				.filter((result) => matchesNodeOptions(result.node, options))
				.slice(0, options?.limit ?? 20),
		);
	}

	private eligibleNodeIds(request: SdkGraphQueryRequest) {
		return statefulIds(this.nodesById.values(), (node) =>
			matchesNodeOptions(node, request.options)
			&& nodeMatchesScope(node, request.scopePaths)
			&& nodeMatchesWhere(node, request.where),
		);
	}

	searchFiles(query: string, options?: SdkGraphSearchOptions) {
		this.onQuery?.('searchFiles', query);
		return this.filterSearchResults(this.rankingIndex.search({ query, scope: 'files', options }), options);
	}

	searchSections(query: string, options?: SdkGraphSearchOptions) {
		this.onQuery?.('searchSections', query);
		return this.filterSearchResults(this.rankingIndex.search({ query, scope: 'sections', options }), options);
	}

	searchEntities(query: string, options?: SdkGraphSearchOptions) {
		this.onQuery?.('searchEntities', query);
		return this.filterSearchResults(this.rankingIndex.search({ query, scope: 'entities', options }), options);
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
		const result = this.queryGraph({
			seedIds: [id],
			options: {
				...options,
				depth: options?.depth ?? 1,
				limit: options?.limit ?? 20,
				maxNodes: options?.maxNodes ?? options?.limit ?? 20,
			},
			relations: ['related', 'references', 'depends_on'],
		});
		return result.nodes.filter((entry) => entry.node.id !== id);
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

	resolveSeeds(request: SdkGraphQueryRequest): SdkGraphSeedResolution {
		this.onQuery?.('resolveSeeds', request.query ?? request.seedIds?.join(',') ?? '');
		const explicitSeeds = request.seeds ?? [];
		const idSeeds = (request.seedIds ?? []).map((id, index) => ({ id: `seed-id:${index}`, kind: 'id', value: id } as SdkGraphSeed));
		const querySeeds = request.query ? [{ id: 'seed-query:0', kind: 'query', value: request.query, scope: request.scope }] : [];
		const seeds = [...explicitSeeds, ...idSeeds, ...querySeeds];
		const matches: SdkGraphSearchResult[] = [];
		const resolvedNodeIds = new Set<string>();

		for (const seed of seeds) {
			if (seed.kind === 'id') {
				const node = this.getNode(seed.value);
				if (node && nodeMatchesScope(node, request.scopePaths) && nodeMatchesWhere(node, request.where)) {
					matches.push({ node, score: 100, reason: 'seed-id' });
					resolvedNodeIds.add(node.id);
				}
				continue;
			}
			if (seed.kind === 'path') {
				const node = this.resolveReference(seed.value)
					?? [...this.nodesById.values()].find((entry) => nodeContentPath(entry) === normalizeScopePath(seed.value))
					?? null;
				if (node && nodeMatchesScope(node, request.scopePaths) && nodeMatchesWhere(node, request.where)) {
					matches.push({ node, score: 90, reason: 'seed-path' });
					resolvedNodeIds.add(node.id);
				}
				continue;
			}
			if (seed.kind === 'tag') {
				for (const node of this.nodesById.values()) {
					if ((node.tags ?? []).map(normalizeText).includes(normalizeText(seed.value))
						&& nodeMatchesScope(node, request.scopePaths)
						&& nodeMatchesWhere(node, request.where)) {
						matches.push({ node, score: 85, reason: 'seed-tag' });
						resolvedNodeIds.add(node.id);
					}
				}
				continue;
			}
			if (seed.kind === 'type') {
				for (const node of this.nodesById.values()) {
					if (nodeMetadataType(node) === normalizeText(seed.value)
						&& nodeMatchesScope(node, request.scopePaths)
						&& nodeMatchesWhere(node, request.where)) {
						matches.push({ node, score: 85, reason: 'seed-type' });
						resolvedNodeIds.add(node.id);
					}
				}
				continue;
			}
			const scoped =
				seed.scope === 'files'
					? this.searchFiles(seed.value, request.options)
					: seed.scope === 'entities'
						? this.searchEntities(seed.value, request.options)
						: seed.scope === 'sections'
							? this.searchSections(seed.value, request.options)
							: this.filterSearchResults(this.rankingIndex.search({ query: seed.value, scope: 'all', options: request.options, request }), request.options);
			for (const match of scoped
				.filter((entry) => nodeMatchesScope(entry.node, request.scopePaths) && nodeMatchesWhere(entry.node, request.where))
				.slice(0, request.options?.limit ?? 10)) {
				matches.push({ ...match, reason: `${match.reason}:seed-query` });
				resolvedNodeIds.add(match.node.id);
			}
		}

		return { seeds, matches: dedupeResults(matches), resolvedNodeIds: [...resolvedNodeIds] };
	}

	queryGraph(request: SdkGraphQueryRequest): SdkGraphQueryResult {
		this.onQuery?.('queryGraph', request.query ?? request.seedIds?.join(',') ?? '');
		const resolved = this.resolveSeeds(request);
		const allowedEdgeTypes = request.relations?.length ? request.relations.map((relation) => RELATION_TO_EDGE_TYPE[relation]) : request.options?.edgeTypes;
		const eligibleNodeIds = this.eligibleNodeIds(request);
		for (const seedId of resolved.resolvedNodeIds) {
			eligibleNodeIds.add(seedId);
		}
		const ranked = this.rankingIndex.rankQuery({
			request,
			seedIds: resolved.resolvedNodeIds.filter((id) => eligibleNodeIds.has(id)),
			seedMatches: resolved.matches.filter((match) => eligibleNodeIds.has(match.node.id)),
			allowedNodeIds: [...eligibleNodeIds],
			allowedEdgeTypes,
		});
		const nodes = ranked.nodes
			.map((entry) => ({
				node: this.nodesById.get(entry.nodeId)!,
				score: entry.score,
				depth: entry.depth,
				reasons: entry.reasons,
				diagnostics: entry.diagnostics,
			}))
			.filter((entry) => Boolean(entry.node) && nodeMatchesScope(entry.node, request.scopePaths) && nodeMatchesWhere(entry.node, request.where));
		const includedNodeIds = new Set(nodes.map((entry) => entry.node.id));
		const edges = ranked.edgeIds
			.map((id) => this.edgesById.get(id))
			.filter((edge): edge is SdkGraphEdge => Boolean(edge))
			.filter((edge) => includedNodeIds.has(edge.sourceId) || includedNodeIds.has(edge.targetId));
		return {
			seedIds: resolved.resolvedNodeIds,
			nodes,
			edges,
			providerId: ranked.providerId,
			diagnostics: ranked.diagnostics,
		};
	}

	buildContextPack(request: SdkContextPackRequest): SdkContextPack {
		this.onQuery?.('buildContextPack', request.query ?? request.seedIds?.join(',') ?? '');
		const graphResult = this.queryGraph(request);
		const maxTokens = request.budget?.maxTokens ?? 1800;
		const includeMode =
			request.budget?.includeMode
			?? (request.view === 'list' || request.view === 'map'
				? 'mixed'
				: request.view === 'full'
					? 'mixed'
					: 'mixed');
		const view = request.view ?? 'brief';
		const includedNodeIds = new Set<string>();
		const nodes: SdkContextPack['nodes'] = [];
		let totalTokenEstimate = 0;

		for (const entry of graphResult.nodes) {
			if (includeMode === 'files' && entry.node.nodeType !== 'File') continue;
			if (includeMode === 'sections' && entry.node.nodeType !== 'Section') continue;
			if (includeMode === 'mixed' && !['File', 'Section'].includes(entry.node.nodeType)) continue;
			if (includeMode === 'mixed' && entry.node.nodeType === 'File' && entry.node.fileId && includedNodeIds.has(entry.node.fileId)) continue;
			const text = excerptForView(entry.node, view);
			if (!text.trim() && !['list', 'map'].includes(view)) continue;
			const estimate = tokenEstimate(text);
			if (totalTokenEstimate + estimate > maxTokens && nodes.length > 0) continue;
			totalTokenEstimate += estimate;
			includedNodeIds.add(entry.node.id);
			nodes.push({
				node: entry.node,
				score: entry.score,
				depth: entry.depth,
				text,
				tokenEstimate: estimate,
				reasons: entry.reasons,
				provenance: {
					seedIds: graphResult.seedIds,
					viaEdgeTypes: graphResult.edges
						.filter((edge) => edge.sourceId === entry.node.id || edge.targetId === entry.node.id)
						.map((edge) => edge.type),
				},
			});
		}

		return {
			seedIds: graphResult.seedIds,
			totalTokenEstimate,
			includedNodeIds: [...includedNodeIds],
			nodes,
			edges: graphResult.edges,
		};
	}

	parseDsl(source: string) {
		return parseGraphDsl(source);
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
			providerId: this.rankingProvider.id,
			ranking: this.rankingIndex.serialize?.() ?? null,
		};
	}
}

function statefulIds(nodes: Iterable<SdkGraphNode>, predicate: (node: SdkGraphNode) => boolean) {
	const ids = new Set<string>();
	for (const node of nodes) {
		if (predicate(node)) {
			ids.add(node.id);
		}
	}
	return ids;
}
