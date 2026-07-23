import { describe, expect, it } from 'vitest';
import { AgentSdk, TreeDxClient } from '../../../src/index.ts';
import type { SdkModelRegistry } from '../../../src/sdk-types.ts';

const liveReady = Boolean(
	process.env.TREEDX_LIVE_URL &&
	process.env.TREEDX_LIVE_TOKEN &&
	process.env.TREEDX_LIVE_REPO_ID,
);

describe('TreeDX live contract', () => {
	function client() {
		return new TreeDxClient({
			baseUrl: process.env.TREEDX_LIVE_URL!,
			token: process.env.TREEDX_LIVE_TOKEN!,
			repoId: process.env.TREEDX_LIVE_REPO_ID!,
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

	it('reads non-mutating contract surfaces from a live TreeDX service', async () => {
		if (!liveReady) {
			expect([
				process.env.TREEDX_LIVE_URL,
				process.env.TREEDX_LIVE_TOKEN,
				process.env.TREEDX_LIVE_REPO_ID,
			].filter(Boolean)).toHaveLength(0);
			return;
		}

		const treedx = client();

		const whoami = await treedx.whoami();
		expect(whoami.authenticated).toBe(true);
		const repo = await treedx.getRepository();
		expect(repo.repoId).toBe(process.env.TREEDX_LIVE_REPO_ID);
		const search = await treedx.searchRepositoryFiles({ query: '', paths: ['**'], limit: 1 });
		expect(search.repoId).toBe(process.env.TREEDX_LIVE_REPO_ID);
		const graph = await treedx.refreshGraph({ paths: ['**'] });
		expect(graph.graphVersion).toMatch(/^graph_/u);
		const job = graph.jobId ? await treedx.getGraphRefreshJob({ jobId: graph.jobId }) : null;
		expect(job?.repoId ?? process.env.TREEDX_LIVE_REPO_ID).toBe(process.env.TREEDX_LIVE_REPO_ID);
		const context = await treedx.buildContext({ query: '', mode: 'brief', budget: { maxNodes: 1, maxTokens: 256 } });
		expect(context.repoId).toBe(process.env.TREEDX_LIVE_REPO_ID);
		const snapshot = await treedx.buildSnapshot({ paths: ['**'] });
		expect(snapshot.snapshotId).toMatch(/^snap_/u);
	});

	it('constructs no-clone AgentSdk against a live TreeDX service', async () => {
		if (!liveReady) {
			expect([
				process.env.TREEDX_LIVE_URL,
				process.env.TREEDX_LIVE_TOKEN,
				process.env.TREEDX_LIVE_REPO_ID,
			].filter(Boolean)).toHaveLength(0);
			return;
		}

		const sdk = new AgentSdk({
			modelRegistry: registry(),
			treeDx: {
				enabled: true,
				baseUrl: process.env.TREEDX_LIVE_URL!,
				token: process.env.TREEDX_LIVE_TOKEN!,
				repoId: process.env.TREEDX_LIVE_REPO_ID!,
				contentPathMap: {
					knowledge: process.env.TREEDX_LIVE_CONTENT_PATH ?? 'src/content/knowledge',
				},
				registryRouting: true,
			},
		});
		expect(sdk.treeDx?.client.baseUrl).toBe(process.env.TREEDX_LIVE_URL!.replace(/\/+$/u, ''));
		const result = await sdk.search({ model: 'knowledge', limit: 1 });
		expect(Array.isArray(result.payload)).toBe(true);
	});

	it('runs mutating no-clone workspace contract when explicitly enabled', async () => {
		if (!liveReady || process.env.TREEDX_LIVE_MUTATING !== 'true') {
			expect(process.env.TREEDX_LIVE_MUTATING).not.toBe('true');
			return;
		}

		const treedx = client();
		const path = process.env.TREEDX_LIVE_WRITE_PATH ?? `tmp/treedx-live-${Date.now()}.md`;
		const workspace = await treedx.createWorkspace({
			mode: 'writable',
			allowedPaths: [path],
			branchName: `refs/heads/treedx-live/${Date.now()}`,
		});
		await treedx.writeFile({
			workspaceId: workspace.workspaceId,
			path,
			content: '---\ntitle: TreeDX Live\n---\n\nLive contract.\n',
		});
		const commit = await treedx.commit({
			workspaceId: workspace.workspaceId,
			message: 'test: TreeDX live contract',
			author: { name: 'TreeDX SDK', email: 'sdk@example.invalid' },
		});
		expect(commit.status).toBe('committed');
		const artifact = await treedx.exportArtifact({ ref: commit.branchName, paths: [path] });
		expect(artifact.uri).toMatch(/^treedx:\/\//u);
	});
});
