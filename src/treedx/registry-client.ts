import { TreeDxClient } from './client.ts';
import type { TreeDxClientOptions, TreeDxNode, TreeDxRepositoryPlacement } from './types.ts';

export interface TreeDxRegistryClientOptions extends TreeDxClientOptions {}

export class TreeDxRegistryClient {
	readonly client: TreeDxClient;

	constructor(options: TreeDxRegistryClientOptions | TreeDxClient) {
		this.client = options instanceof TreeDxClient ? options : new TreeDxClient(options);
	}

	listNodes(): Promise<TreeDxNode[]> {
		return this.client.listNodes();
	}

	resolveRepository(repoId: string): Promise<TreeDxRepositoryPlacement> {
		return this.client.getPlacement(repoId);
	}

	resolveRepositories(repoIds: string[]): Promise<TreeDxRepositoryPlacement[]> {
		return Promise.all(repoIds.map((repoId) => this.resolveRepository(repoId)));
	}
}
