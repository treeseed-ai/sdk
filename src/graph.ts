import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
	SdkContextPack,
	SdkContextPackRequest,
	SdkGraphPathExplanation,
	SdkGraphDslParseResult,
	SdkGraphQueryOptions,
	SdkGraphQueryRequest,
	SdkGraphQueryResult,
	SdkGraphRefreshPayload,
	SdkGraphRefreshRequest,
	SdkGraphSearchOptions,
	SdkGraphSearchResult,
	SdkGraphSeedResolution,
	SdkGraphTraversalResult,
	SdkModelRegistry,
	SdkGraphRankingProvider,
} from './sdk-types.ts';
import { loadGraphSnapshot, refreshGraphBuildState, saveGraphSnapshot, type GraphBuildState } from './graph/build.ts';
import { GraphQueryEngine } from './graph/query.ts';
import { DEFAULT_GRAPH_RANKING_PROVIDER } from './graph/ranking.ts';
import type { LoadedTreeseedPluginEntry } from './platform/plugins.ts';
import { resolveTreeseedGraphRankingProvider } from './platform/plugins.ts';

export interface ContentGraphRuntimeOptions {
	rankingProvider?: SdkGraphRankingProvider;
	plugins?: LoadedTreeseedPluginEntry[];
}

/** Advanced direct graph runtime used internally by AgentSdk and available for low-level integrations. */
export class ContentGraphRuntime {
	private state: GraphBuildState | null = null;
	private queryEngine: GraphQueryEngine | null = null;
	private readonly rankingProvider: SdkGraphRankingProvider;

	constructor(
		private readonly repoRoot: string,
		private readonly models: SdkModelRegistry,
		options: ContentGraphRuntimeOptions = {},
	) {
		this.rankingProvider = options.rankingProvider
			?? (options.plugins?.length
				? resolveTreeseedGraphRankingProvider(options.plugins, { projectRoot: repoRoot }) ?? DEFAULT_GRAPH_RANKING_PROVIDER
				: DEFAULT_GRAPH_RANKING_PROVIDER);
	}

	private trackQuery(name: string, detail?: string) {
		if (!this.state) {
			return;
		}
		this.state.metrics.queryCounts[name] = (this.state.metrics.queryCounts[name] ?? 0) + 1;
		if (detail && name === 'followReferences') {
			const edgeType = detail.split(':')[0] ?? 'follow';
			this.state.metrics.topTraversedEdgeTypes[edgeType] = (this.state.metrics.topTraversedEdgeTypes[edgeType] ?? 0) + 1;
		}
	}

	private async ensureLoaded() {
		if (this.state && this.queryEngine) {
			return;
		}
		this.state = await loadGraphSnapshot(this.repoRoot, this.models);
		if (!this.state) {
			this.state = await refreshGraphBuildState(this.repoRoot, this.models);
			await this.persist();
		}
		this.queryEngine = new GraphQueryEngine(this.state, (name, detail) => this.trackQuery(name, detail), this.rankingProvider);
	}

	private async persist() {
		if (!this.state || !this.queryEngine) {
			return;
		}
		await saveGraphSnapshot(this.state);
		const serializedIndexes = this.queryEngine.serializeIndexes();
		await writeFile(
			path.join(this.state.snapshotRoot, 'indexes.json'),
			`${JSON.stringify(serializedIndexes, null, 2)}\n`,
			'utf8',
		);
	}

	async refresh(request?: SdkGraphRefreshRequest): Promise<SdkGraphRefreshPayload> {
		await this.ensureLoaded();
		this.state = await refreshGraphBuildState(this.repoRoot, this.models, request, this.state);
		this.queryEngine = new GraphQueryEngine(this.state, (name, detail) => this.trackQuery(name, detail), this.rankingProvider);
		await this.persist();
		return {
			ready: true,
			snapshotRoot: this.state.snapshotRoot,
			changed: this.state.delta,
			metrics: this.state.metrics,
		};
	}

	/** Advanced lexical graph primitive for file nodes. */
	async searchFiles(query: string, options?: SdkGraphSearchOptions): Promise<SdkGraphSearchResult[]> {
		await this.ensureLoaded();
		return this.queryEngine!.searchFiles(query, options);
	}

	/** Advanced lexical graph primitive for section nodes. */
	async searchSections(query: string, options?: SdkGraphSearchOptions): Promise<SdkGraphSearchResult[]> {
		await this.ensureLoaded();
		return this.queryEngine!.searchSections(query, options);
	}

	/** Advanced lexical graph primitive for entity nodes. */
	async searchEntities(query: string, options?: SdkGraphSearchOptions): Promise<SdkGraphSearchResult[]> {
		await this.ensureLoaded();
		return this.queryEngine!.searchEntities(query, options);
	}

	async getNode(id: string) {
		await this.ensureLoaded();
		return this.queryEngine!.getNode(id);
	}

	async getNeighbors(id: string, options?: SdkGraphQueryOptions) {
		await this.ensureLoaded();
		return this.queryEngine!.getNeighbors(id, options);
	}

	async followReferences(id: string, options?: SdkGraphQueryOptions): Promise<SdkGraphTraversalResult> {
		await this.ensureLoaded();
		return this.queryEngine!.followReferences(id, options);
	}

	async getBacklinks(id: string, options?: SdkGraphQueryOptions) {
		await this.ensureLoaded();
		return this.queryEngine!.getBacklinks(id, options);
	}

	async getRelated(id: string, options?: SdkGraphQueryOptions) {
		await this.ensureLoaded();
		return this.queryEngine!.getRelated(id, options);
	}

	async getSubgraph(seedIds: string[], options?: SdkGraphQueryOptions): Promise<SdkGraphTraversalResult> {
		await this.ensureLoaded();
		return this.queryEngine!.getSubgraph(seedIds, options);
	}

	async resolveSeeds(request: SdkGraphQueryRequest): Promise<SdkGraphSeedResolution> {
		await this.ensureLoaded();
		return this.queryEngine!.resolveSeeds(request);
	}

	/** Preferred ranked graph retrieval entrypoint when using the graph runtime directly. */
	async queryGraph(request: SdkGraphQueryRequest): Promise<SdkGraphQueryResult> {
		await this.ensureLoaded();
		return this.queryEngine!.queryGraph(request);
	}

	/** Preferred prompt-ready context assembly entrypoint when using the graph runtime directly. */
	async buildContextPack(request: SdkContextPackRequest): Promise<SdkContextPack> {
		await this.ensureLoaded();
		return this.queryEngine!.buildContextPack(request);
	}

	/** Parses the public ctx DSL into a typed graph request. */
	async parseGraphDsl(source: string): Promise<SdkGraphDslParseResult> {
		await this.ensureLoaded();
		return this.queryEngine!.parseDsl(source);
	}

	async resolveReference(reference: string, options?: { fromNodeId?: string; fromPath?: string; models?: string[] }) {
		await this.ensureLoaded();
		return this.queryEngine!.resolveReference(reference, options);
	}

	async explainReferenceChain(fromId: string, toId: string): Promise<SdkGraphPathExplanation | null> {
		await this.ensureLoaded();
		return this.queryEngine!.explainReferenceChain(fromId, toId);
	}
}
