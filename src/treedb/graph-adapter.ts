import { TreeDbClient } from './client.ts';
import { TreeDbApiError } from './errors.ts';
import type {
	SdkContextPack,
	SdkContextPackRequest,
	SdkGraphDslParseResult,
	SdkGraphNode,
	SdkGraphQueryOptions,
	SdkGraphQueryRequest,
	SdkGraphQueryResult,
	SdkGraphRefreshPayload,
	SdkGraphRefreshRequest,
	SdkGraphSearchOptions,
	SdkGraphSearchResult,
	SdkGraphSeedResolution,
	SdkGraphTraversalResult,
	TreeDbGraphQueryResult,
} from './types.ts';

export interface TreeDbGraphAdapterOptions {
	client: TreeDbClient;
	repoId?: string;
	defaultRef?: string;
}

export class TreeDbGraphAdapter {
	constructor(private readonly options: TreeDbGraphAdapterOptions) {}

	async refresh(request: SdkGraphRefreshRequest = {}): Promise<SdkGraphRefreshPayload> {
		return this.options.client.refreshGraph({
			...request,
			repoId: this.options.repoId,
			ref: this.options.defaultRef,
		});
	}

	searchFiles(query: string, options?: SdkGraphSearchOptions): Promise<SdkGraphSearchResult[]> {
		return this.options.client.searchGraphFiles({
			repoId: this.options.repoId,
			ref: this.options.defaultRef,
			query,
			limit: options?.limit,
			options,
		});
	}

	searchSections(query: string, options?: SdkGraphSearchOptions): Promise<SdkGraphSearchResult[]> {
		return this.options.client.searchGraphSections({
			repoId: this.options.repoId,
			ref: this.options.defaultRef,
			query,
			limit: options?.limit,
			options,
		});
	}

	searchEntities(query: string, options?: SdkGraphSearchOptions): Promise<SdkGraphSearchResult[]> {
		return this.options.client.searchGraphEntities({
			repoId: this.options.repoId,
			ref: this.options.defaultRef,
			query,
			limit: options?.limit,
			options,
		});
	}

	async getNode(id: string): Promise<SdkGraphNode | null> {
		try {
			return await this.options.client.getGraphNode({
				repoId: this.options.repoId,
				ref: this.options.defaultRef,
				nodeId: id,
			}) as SdkGraphNode;
		} catch (error) {
			if (error instanceof TreeDbApiError && error.status === 404) {
				return null;
			}
			throw error;
		}
	}

	getNeighbors(id: string, options?: SdkGraphQueryOptions): Promise<SdkGraphTraversalResult> {
		return this.related(id, [], options);
	}

	followReferences(id: string, options?: SdkGraphQueryOptions): Promise<SdkGraphTraversalResult> {
		return this.related(id, ['references'], options);
	}

	getBacklinks(id: string, options?: SdkGraphQueryOptions): Promise<SdkGraphTraversalResult> {
		return this.related(id, [], { ...options, direction: 'incoming' });
	}

	getRelated(id: string, options?: SdkGraphQueryOptions): Promise<SdkGraphTraversalResult> {
		return this.related(id, ['related'], options);
	}

	async getSubgraph(seedIds: string[], options?: SdkGraphQueryOptions): Promise<SdkGraphTraversalResult> {
		const result = await this.options.client.getSubgraph({
			repoId: this.options.repoId,
			ref: this.options.defaultRef,
			seedIds,
			options,
		});
		return {
			seedId: String(result.seedId ?? seedIds.join(',')),
			nodes: (result.nodes ?? []).map((entry: unknown) => this.unwrapNode(entry)),
			edges: (result.edges ?? []) as SdkGraphTraversalResult['edges'],
		};
	}

	async resolveSeeds(_request: SdkGraphQueryRequest): Promise<SdkGraphSeedResolution> {
		throw new TreeDbApiError('TreeDB remote graph seed resolution is not implemented in Phase 7.', {
			status: 501,
			code: 'unsupported_tree_db_graph_operation',
		});
	}

	async queryGraph(request: SdkGraphQueryRequest): Promise<SdkGraphQueryResult> {
		const result = await this.options.client.queryGraph({
			...request,
			repoId: this.options.repoId,
			ref: this.options.defaultRef,
		}) as TreeDbGraphQueryResult;
		return {
			seedIds: result.seedIds,
			nodes: result.nodes,
			edges: result.edges,
			providerId: result.providerId,
			diagnostics: result.diagnostics,
		};
	}

	async buildContextPack(request: SdkContextPackRequest): Promise<SdkContextPack> {
		const result = await this.options.client.buildContext({
			...request,
			repoId: this.options.repoId,
			ref: this.options.defaultRef,
		});
		return {
			seedIds: result.seedIds,
			totalTokenEstimate: result.totalTokenEstimate,
			includedNodeIds: result.includedNodeIds,
			nodes: result.nodes,
			edges: result.edges,
		};
	}

	parseGraphDsl(source: string): Promise<SdkGraphDslParseResult> {
		return this.options.client.parseContextDsl({
			repoId: this.options.repoId,
			ref: this.options.defaultRef,
			source,
		});
	}

	resolveReference(_reference?: string, _options?: { fromNodeId?: string; fromPath?: string; models?: string[] }): Promise<never> {
		return Promise.reject(new TreeDbApiError('TreeDB remote reference resolution is not implemented in Phase 7.', {
			status: 501,
			code: 'unsupported_tree_db_graph_operation',
		}));
	}

	explainReferenceChain(_fromId?: string, _toId?: string): Promise<never> {
		return Promise.reject(new TreeDbApiError('TreeDB remote reference-chain explanation is not implemented in Phase 7.', {
			status: 501,
			code: 'unsupported_tree_db_graph_operation',
		}));
	}

	private async related(id: string, relations: string[], options?: SdkGraphQueryOptions): Promise<SdkGraphTraversalResult> {
		const result = await this.options.client.getRelated({
			repoId: this.options.repoId,
			ref: this.options.defaultRef,
			nodeId: id,
			relations,
			options,
		});
		return {
			seedId: id,
			nodes: (result.nodes ?? []).map((entry: unknown) => this.unwrapNode(entry)),
			edges: (result.edges ?? []) as SdkGraphTraversalResult['edges'],
		};
	}

	private unwrapNode(entry: unknown): SdkGraphNode {
		if (typeof entry === 'object' && entry !== null && 'node' in entry) {
			return (entry as { node: SdkGraphNode }).node;
		}
		return entry as SdkGraphNode;
	}
}
