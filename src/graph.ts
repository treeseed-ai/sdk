import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
	SdkGraphPathExplanation,
	SdkGraphQueryOptions,
	SdkGraphRefreshPayload,
	SdkGraphRefreshRequest,
	SdkGraphSearchOptions,
	SdkGraphSearchResult,
	SdkGraphTraversalResult,
	SdkModelRegistry,
} from './sdk-types.ts';
import { loadGraphSnapshot, refreshGraphBuildState, saveGraphSnapshot, type GraphBuildState } from './graph/build.ts';
import { GraphQueryEngine } from './graph/query.ts';

export class ContentGraphRuntime {
	private state: GraphBuildState | null = null;
	private queryEngine: GraphQueryEngine | null = null;

	constructor(
		private readonly repoRoot: string,
		private readonly models: SdkModelRegistry,
	) {}

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
		this.queryEngine = new GraphQueryEngine(this.state, (name, detail) => this.trackQuery(name, detail));
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
		this.queryEngine = new GraphQueryEngine(this.state, (name, detail) => this.trackQuery(name, detail));
		await this.persist();
		return {
			ready: true,
			snapshotRoot: this.state.snapshotRoot,
			changed: this.state.delta,
			metrics: this.state.metrics,
		};
	}

	async searchFiles(query: string, options?: SdkGraphSearchOptions): Promise<SdkGraphSearchResult[]> {
		await this.ensureLoaded();
		return this.queryEngine!.searchFiles(query, options);
	}

	async searchSections(query: string, options?: SdkGraphSearchOptions): Promise<SdkGraphSearchResult[]> {
		await this.ensureLoaded();
		return this.queryEngine!.searchSections(query, options);
	}

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

	async resolveReference(reference: string, options?: { fromNodeId?: string; fromPath?: string; models?: string[] }) {
		await this.ensureLoaded();
		return this.queryEngine!.resolveReference(reference, options);
	}

	async explainReferenceChain(fromId: string, toId: string): Promise<SdkGraphPathExplanation | null> {
		await this.ensureLoaded();
		return this.queryEngine!.explainReferenceChain(fromId, toId);
	}
}
