import { TreeDbClient } from './client.ts';
import { TreeDbApiError } from './errors.ts';
import { TreeDbRegistryClient, type TreeDbRegistryClientOptions } from './registry-client.ts';
import type {
	TreeDbFederatedContextRequest,
	TreeDbFederatedContextResult,
	TreeDbFederatedGraphRequest,
	TreeDbFederatedGraphResult,
	TreeDbFederatedQueryRequest,
	TreeDbFederatedQueryResult,
	TreeDbFederatedSearchRequest,
	TreeDbFederatedSearchResult,
	TreeDbFederationQueryPlan,
	TreeDbFederationQueryPlanRequest,
	TreeDbRepositoryPlacement,
} from './types.ts';

export interface TreeDbFederatedClientOptions {
	registry: TreeDbRegistryClientOptions | TreeDbRegistryClient;
	token?: string;
	fetch?: typeof fetch;
	nodeBaseUrls?: Record<string, string>;
}

function placementRepoId(placement: TreeDbRepositoryPlacement, fallback: string) {
	return placement.repositoryId ?? placement.repoId ?? fallback;
}

export class TreeDbFederatedClient {
	private readonly registry: TreeDbRegistryClient;
	private readonly token?: string;
	private readonly fetchImpl?: typeof fetch;
	private readonly nodeBaseUrls: Record<string, string>;

	constructor(options: TreeDbFederatedClientOptions) {
		this.registry = options.registry instanceof TreeDbRegistryClient
			? options.registry
			: new TreeDbRegistryClient(options.registry);
		this.token = options.token;
		this.fetchImpl = options.fetch;
		this.nodeBaseUrls = options.nodeBaseUrls ?? {};
	}

	async resolveRepository(repoId: string): Promise<TreeDbClient> {
		return this.resolveRepositoryForWrite(repoId);
	}

	async resolveRepositoryForRead(repoId: string): Promise<TreeDbClient> {
		return this.clientForPlacement(await this.registry.resolveRepository(repoId), repoId);
	}

	async resolveRepositoryForWrite(repoId: string): Promise<TreeDbClient> {
		return this.clientForPlacement(await this.registry.resolveRepository(repoId), repoId);
	}

	async planQuery(input: TreeDbFederationQueryPlanRequest): Promise<TreeDbFederationQueryPlan> {
		return this.registry.client.planFederatedQuery(input);
	}

	async query(input: TreeDbFederatedQueryRequest): Promise<TreeDbFederatedQueryResult> {
		const repoIds = input.repoIds ?? (input.repoId ? [input.repoId] : []);
		if (repoIds.length !== 1) {
			return this.federatedQuery({ ...input, repoIds });
		}
		const repoId = repoIds[0]!;
		try {
			const client = await this.resolveRepositoryForRead(repoId);
			const result = await client.queryRepository({ ...input, repoId });
			return singleQueryResult(repoId, input.type, result);
		} catch (error) {
			if (input.includeErrors && error instanceof TreeDbApiError) {
				return {
					type: input.type,
					results: [],
					page: { limit: input.limit ?? 20, hasMore: false, cursor: null },
					diagnostics: singleDiagnostics(repoId, 1),
					errors: [{ repoId, code: error.code, message: error.message, status: error.status }],
				};
			}
			throw error;
		}
	}

	async search(input: TreeDbFederatedSearchRequest): Promise<TreeDbFederatedSearchResult> {
		const repoIds = input.repoIds ?? (input.repoId ? [input.repoId] : []);
		if (repoIds.length !== 1) {
			return this.federatedSearch({ ...input, repoIds });
		}
		const repoId = repoIds[0]!;
		try {
			const client = await this.resolveRepositoryForRead(repoId);
			const result = await client.searchRepositoryFiles({ ...input, repoId });
			return singleSearchResult(repoId, input.query, result);
		} catch (error) {
			if (input.includeErrors && error instanceof TreeDbApiError) {
				return {
					query: input.query,
					results: [],
					page: { limit: input.limit ?? 20, hasMore: false, cursor: null },
					diagnostics: singleDiagnostics(repoId, 1),
					errors: [{ repoId, code: error.code, message: error.message, status: error.status }],
				};
			}
			throw error;
		}
	}

	async federatedSearch(input: TreeDbFederatedSearchRequest): Promise<TreeDbFederatedSearchResult> {
		return this.registry.client.federatedSearch(input);
	}

	async federatedQuery(input: TreeDbFederatedQueryRequest): Promise<TreeDbFederatedQueryResult> {
		return this.registry.client.federatedQuery(input);
	}

	async federatedContext(input: TreeDbFederatedContextRequest): Promise<TreeDbFederatedContextResult> {
		return this.registry.client.federatedContext(input);
	}

	async federatedGraph(input: TreeDbFederatedGraphRequest): Promise<TreeDbFederatedGraphResult> {
		return this.registry.client.federatedGraph(input);
	}

	private async clientForPlacement(placement: TreeDbRepositoryPlacement, fallbackRepoId: string) {
		const nodeId = placement.primaryNodeId;
		let baseUrl = this.nodeBaseUrls[nodeId];
		if (!baseUrl) {
			const nodes = await this.registry.listNodes();
			baseUrl = nodes.find((node) => node.id === nodeId)?.baseUrl;
		}
		if (!baseUrl) {
			throw new TreeDbApiError(`TreeDB node "${nodeId}" is not configured.`, {
				status: 404,
				code: 'node_not_configured',
				details: { nodeId },
			});
		}
		return new TreeDbClient({
			baseUrl,
			token: this.token,
			fetch: this.fetchImpl,
			repoId: placementRepoId(placement, fallbackRepoId),
		});
	}
}

function singleDiagnostics(repoId: string, partialFailureCount = 0) {
	return {
		requestedRepoCount: 1,
		executedRepoCount: partialFailureCount === 0 ? 1 : 0,
		rejectedRepoCount: 0,
		partialFailureCount,
		routing: [
			{
				repoId,
				source: 'remote' as const,
				status: partialFailureCount === 0 ? 'ok' as const : 'partial_failure' as const,
			},
		],
	};
}

function resultItems(result: Record<string, unknown>, repoId: string) {
	const ref = typeof result.ref === 'string' ? result.ref : 'refs/heads/main';
	const items = Array.isArray(result.results) ? result.results : [];
	return items.map((item) => ({
		...(typeof item === 'object' && item !== null ? item as Record<string, unknown> : { value: item }),
		repoId,
		ref,
		source: 'remote' as const,
	}));
}

function resultPage(result: Record<string, unknown>, limit = 20) {
	return typeof result.page === 'object' && result.page !== null
		? result.page as { limit: number; hasMore: boolean; cursor?: string | null }
		: { limit, hasMore: false, cursor: null };
}

function singleQueryResult(repoId: string, type: string, result: Record<string, unknown>): TreeDbFederatedQueryResult {
	return {
		type: typeof result.type === 'string' ? result.type : type,
		results: resultItems(result, repoId),
		page: resultPage(result),
		diagnostics: singleDiagnostics(repoId),
		errors: [],
	};
}

function singleSearchResult(repoId: string, query: string, result: Record<string, unknown>): TreeDbFederatedSearchResult {
	return {
		query,
		results: resultItems(result, repoId),
		page: resultPage(result),
		diagnostics: singleDiagnostics(repoId),
		errors: [],
	};
}
