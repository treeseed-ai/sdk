import { describe, expect, it } from 'vitest';
import { AgentSdk, TreeDbClient } from '../../src/index.ts';
import type { SdkModelRegistry } from '../../src/sdk-types.ts';

const liveReady = Boolean(
	process.env.TREEDB_LIVE_URL &&
	process.env.TREEDB_LIVE_TOKEN &&
	process.env.TREEDB_LIVE_REPO_ID,
);

describe('TreeDB live contract', () => {
	function client() {
		return new TreeDbClient({
			baseUrl: process.env.TREEDB_LIVE_URL!,
			token: process.env.TREEDB_LIVE_TOKEN!,
			repoId: process.env.TREEDB_LIVE_REPO_ID!,
		});
	}

	function registry(): SdkModelRegistry {
		return {
			knowledge: {
				name: 'knowledge',
				aliases: ['knowledge'],
				storage: 'content',
				operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
				fields: {
					title: { key: 'title', contentKeys: ['title'], filterable: true, sortable: true },
					slug: { key: 'slug', contentKeys: ['slug'], filterable: true },
					updated_at: { key: 'updated_at', contentKeys: ['updated_at'], filterable: true, sortable: true },
				},
				filterableFields: ['title', 'slug', 'updated_at'],
				sortableFields: ['title', 'updated_at'],
				pickField: 'updated_at',
				contentDir: '/remote/src/content/knowledge',
			},
		};
	}

	it('reads non-mutating contract surfaces from a live TreeDB service', async () => {
		if (!liveReady) {
			expect([
				process.env.TREEDB_LIVE_URL,
				process.env.TREEDB_LIVE_TOKEN,
				process.env.TREEDB_LIVE_REPO_ID,
			].filter(Boolean)).toHaveLength(0);
			return;
		}

		const treedb = client();

		const whoami = await treedb.whoami();
		expect(whoami.authenticated).toBe(true);
		const repo = await treedb.getRepository();
		expect(repo.repoId).toBe(process.env.TREEDB_LIVE_REPO_ID);
		const search = await treedb.searchRepositoryFiles({ query: '', paths: ['**'], limit: 1 });
		expect(search.repoId).toBe(process.env.TREEDB_LIVE_REPO_ID);
		const graph = await treedb.refreshGraph({ paths: ['**'] });
		expect(graph.graphVersion).toMatch(/^graph_/u);
		const job = graph.jobId ? await treedb.getGraphRefreshJob({ jobId: graph.jobId }) : null;
		expect(job?.repoId ?? process.env.TREEDB_LIVE_REPO_ID).toBe(process.env.TREEDB_LIVE_REPO_ID);
		const context = await treedb.buildContext({ query: '', mode: 'brief', budget: { maxNodes: 1, maxTokens: 256 } });
		expect(context.repoId).toBe(process.env.TREEDB_LIVE_REPO_ID);
		const snapshot = await treedb.buildSnapshot({ paths: ['**'] });
		expect(snapshot.snapshotId).toMatch(/^snap_/u);
	});

	it('constructs no-clone AgentSdk against a live TreeDB service', async () => {
		if (!liveReady) {
			expect([
				process.env.TREEDB_LIVE_URL,
				process.env.TREEDB_LIVE_TOKEN,
				process.env.TREEDB_LIVE_REPO_ID,
			].filter(Boolean)).toHaveLength(0);
			return;
		}

		const sdk = new AgentSdk({
			modelRegistry: registry(),
			treeDb: {
				enabled: true,
				baseUrl: process.env.TREEDB_LIVE_URL!,
				token: process.env.TREEDB_LIVE_TOKEN!,
				repoId: process.env.TREEDB_LIVE_REPO_ID!,
				contentPathMap: {
					knowledge: process.env.TREEDB_LIVE_CONTENT_PATH ?? 'src/content/knowledge',
				},
				registryRouting: true,
			},
		});
		expect(sdk.treeDb?.client.baseUrl).toBe(process.env.TREEDB_LIVE_URL!.replace(/\/+$/u, ''));
		const result = await sdk.search({ model: 'knowledge', limit: 1 });
		expect(Array.isArray(result.payload)).toBe(true);
	});

	it('runs mutating no-clone workspace contract when explicitly enabled', async () => {
		if (!liveReady || process.env.TREEDB_LIVE_MUTATING !== 'true') {
			expect(process.env.TREEDB_LIVE_MUTATING).not.toBe('true');
			return;
		}

		const treedb = client();
		const path = process.env.TREEDB_LIVE_WRITE_PATH ?? `tmp/treedb-live-${Date.now()}.md`;
		const workspace = await treedb.createWorkspace({
			mode: 'writable',
			allowedPaths: [path],
			branchName: `refs/heads/treedb-live/${Date.now()}`,
		});
		await treedb.writeFile({
			workspaceId: workspace.workspaceId,
			path,
			content: '---\ntitle: TreeDB Live\n---\n\nLive contract.\n',
		});
		const commit = await treedb.commit({
			workspaceId: workspace.workspaceId,
			message: 'test: TreeDB live contract',
			author: { name: 'TreeDB SDK', email: 'sdk@example.invalid' },
		});
		expect(commit.status).toBe('committed');
		const artifact = await treedb.exportArtifact({ ref: commit.branchName, paths: [path] });
		expect(artifact.uri).toMatch(/^treedb:\/\//u);
	});
});
