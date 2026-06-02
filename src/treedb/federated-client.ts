import { TreeDbClient } from './client.ts';
import { TreeDbApiError } from './errors.ts';
import { TreeDbRegistryClient, type TreeDbRegistryClientOptions } from './registry-client.ts';
import type {
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
			throw new TreeDbApiError('Federated multi-repository query is not implemented in Phase 7.', {
				status: 501,
				code: 'federated_query_not_implemented',
			});
		}
		const repoId = repoIds[0]!;
		try {
			const client = await this.resolveRepositoryForRead(repoId);
			return {
				results: [{ repoId, result: await client.queryRepository({ ...input, repoId }) }],
			};
		} catch (error) {
			if (input.includeErrors && error instanceof TreeDbApiError) {
				return {
					results: [],
					errors: [{ repoId, error: { code: error.code, message: error.message, status: error.status } }],
				};
			}
			throw error;
		}
	}

	async search(input: TreeDbFederatedSearchRequest): Promise<TreeDbFederatedSearchResult> {
		const repoIds = input.repoIds ?? (input.repoId ? [input.repoId] : []);
		if (repoIds.length !== 1) {
			throw new TreeDbApiError('Federated multi-repository search is not implemented in Phase 7.', {
				status: 501,
				code: 'federated_query_not_implemented',
			});
		}
		const repoId = repoIds[0]!;
		try {
			const client = await this.resolveRepositoryForRead(repoId);
			return {
				results: [{ repoId, result: await client.searchRepositoryFiles({ ...input, repoId }) }],
			};
		} catch (error) {
			if (input.includeErrors && error instanceof TreeDbApiError) {
				return {
					results: [],
					errors: [{ repoId, error: { code: error.code, message: error.message, status: error.status } }],
				};
			}
			throw error;
		}
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
