import { TreeDbClient } from './client.ts';
import type { TreeDbClientOptions, TreeDbNode, TreeDbRepositoryPlacement } from './types.ts';

export interface TreeDbRegistryClientOptions extends TreeDbClientOptions {}

export class TreeDbRegistryClient {
	private readonly client: TreeDbClient;

	constructor(options: TreeDbRegistryClientOptions | TreeDbClient) {
		this.client = options instanceof TreeDbClient ? options : new TreeDbClient(options);
	}

	listNodes(): Promise<TreeDbNode[]> {
		return this.client.listNodes();
	}

	resolveRepository(repoId: string): Promise<TreeDbRepositoryPlacement> {
		return this.client.getPlacement(repoId);
	}

	resolveRepositories(repoIds: string[]): Promise<TreeDbRepositoryPlacement[]> {
		return Promise.all(repoIds.map((repoId) => this.resolveRepository(repoId)));
	}
}
