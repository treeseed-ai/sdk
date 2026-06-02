import { describe, expect, it } from 'vitest';
import { TreeDbClient } from '../../src/treedb/index.ts';

const liveReady = Boolean(
	process.env.TREEDB_LIVE_URL &&
	process.env.TREEDB_LIVE_TOKEN &&
	process.env.TREEDB_LIVE_REPO_ID,
);

describe.skipIf(!liveReady)('TreeDB live contract', () => {
	it('reads non-mutating contract surfaces from a live TreeDB service', async () => {
		const client = new TreeDbClient({
			baseUrl: process.env.TREEDB_LIVE_URL!,
			token: process.env.TREEDB_LIVE_TOKEN!,
			repoId: process.env.TREEDB_LIVE_REPO_ID!,
		});

		const whoami = await client.whoami();
		expect(whoami.authenticated).toBe(true);
		const repo = await client.getRepository();
		expect(repo.repoId).toBe(process.env.TREEDB_LIVE_REPO_ID);
		const search = await client.searchRepositoryFiles({ query: '', paths: ['**'], limit: 1 });
		expect(search.repoId).toBe(process.env.TREEDB_LIVE_REPO_ID);
		const graph = await client.refreshGraph({ paths: ['**'] });
		expect(graph.graphVersion).toMatch(/^graph_/u);
		const snapshot = await client.buildSnapshot({ paths: ['**'] });
		expect(snapshot.snapshotId).toMatch(/^snap_/u);
	});
});
