import { TreeDxClient } from '../support/client.ts';
import { TreeDxApiError } from '../support/errors.ts';
import { TreeDxRegistryClient, type TreeDxRegistryClientOptions } from '../support/registry-client.ts';
import type {
	TreeDxFederatedContextRequest,
	TreeDxFederatedContextResult,
	TreeDxFederatedGraphRequest,
	TreeDxFederatedGraphResult,
	TreeDxFederatedQueryRequest,
	TreeDxFederatedQueryResult,
	TreeDxFederatedSearchRequest,
	TreeDxFederatedSearchResult,
	TreeDxFederationQueryPlan,
	TreeDxFederationQueryPlanRequest,
	TreeDxRepositoryPlacement,
} from '../types.ts';

export interface TreeDxFederatedClientOptions {
	registry: TreeDxRegistryClientOptions | TreeDxRegistryClient;
	token?: string;
	fetch?: typeof fetch;
	nodeBaseUrls?: Record<string, string>;
}

function placementRepoId(placement: TreeDxRepositoryPlacement, fallback: string) {
	return placement.repositoryId ?? placement.repoId ?? fallback;
}

export class TreeDxFederatedClient {
	private readonly registry: TreeDxRegistryClient;
	private readonly token?: string;
	private readonly fetchImpl?: typeof fetch;
	private readonly nodeBaseUrls: Record<string, string>;

	constructor(options: TreeDxFederatedClientOptions) {
		this.registry = options.registry instanceof TreeDxRegistryClient
			? options.registry
			: new TreeDxRegistryClient(options.registry);
		this.token = options.token;
		this.fetchImpl = options.fetch;
		this.nodeBaseUrls = options.nodeBaseUrls ?? {};
	}

	async resolveRepository(repoId: string): Promise<TreeDxClient> {
		return this.resolveRepositoryForWrite(repoId);
	}

	async resolveRepositoryForRead(repoId: string): Promise<TreeDxClient> {
		return this.clientForPlacement(await this.registry.resolveRepository(repoId), repoId);
	}

	async resolveRepositoryForWrite(repoId: string): Promise<TreeDxClient> {
		return this.clientForPlacement(await this.registry.resolveRepository(repoId), repoId);
	}

	async planQuery(input: TreeDxFederationQueryPlanRequest): Promise<TreeDxFederationQueryPlan> {
		return this.registry.client.planFederatedQuery(input);
	}

	async query(input: TreeDxFederatedQueryRequest): Promise<TreeDxFederatedQueryResult> {
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
			if (input.includeErrors && error instanceof TreeDxApiError) {
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

	async search(input: TreeDxFederatedSearchRequest): Promise<TreeDxFederatedSearchResult> {
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
			if (input.includeErrors && error instanceof TreeDxApiError) {
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

	async federatedSearch(input: TreeDxFederatedSearchRequest): Promise<TreeDxFederatedSearchResult> {
		return this.registry.client.federatedSearch(input);
	}

	async federatedQuery(input: TreeDxFederatedQueryRequest): Promise<TreeDxFederatedQueryResult> {
		return this.registry.client.federatedQuery(input);
	}

	async federatedContext(input: TreeDxFederatedContextRequest): Promise<TreeDxFederatedContextResult> {
		return this.registry.client.federatedContext(input);
	}

	async federatedGraph(input: TreeDxFederatedGraphRequest): Promise<TreeDxFederatedGraphResult> {
		return this.registry.client.federatedGraph(input);
	}

	private async clientForPlacement(placement: TreeDxRepositoryPlacement, fallbackRepoId: string) {
		const nodeId = placement.primaryNodeId;
		let baseUrl = this.nodeBaseUrls[nodeId];
		if (!baseUrl) {
			const nodes = await this.registry.listNodes();
			baseUrl = nodes.find((node) => node.id === nodeId)?.baseUrl;
		}
		if (!baseUrl) {
			throw new TreeDxApiError(`TreeDX node "${nodeId}" is not configured.`, {
				status: 404,
				code: 'node_not_configured',
				details: { nodeId },
			});
		}
		return new TreeDxClient({
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

function singleQueryResult(repoId: string, type: string, result: Record<string, unknown>): TreeDxFederatedQueryResult {
	return {
		type: typeof result.type === 'string' ? result.type : type,
		results: resultItems(result, repoId),
		page: resultPage(result),
		diagnostics: singleDiagnostics(repoId),
		errors: [],
	};
}

function singleSearchResult(repoId: string, query: string, result: Record<string, unknown>): TreeDxFederatedSearchResult {
	return {
		query,
		results: resultItems(result, repoId),
		page: resultPage(result),
		diagnostics: singleDiagnostics(repoId),
		errors: [],
	};
}
