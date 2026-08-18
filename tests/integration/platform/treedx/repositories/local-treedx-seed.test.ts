import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	collectLocalTreeDxSeedFiles,
	localTreeDxSeedDigest,
	verifyLocalTreeDxSeedFiles,
} from '../../../../../src/platform/treedx/repositories/local-treedx-seed.ts';
import { verifyLocalTreeDxProjectContent } from '../../../../../src/reconcile/builtin-adapters/projects/knowledge/verify-local-tree-dx-project-content.ts';

describe('local TreeDX seed desired state', () => {
	it('is stable across traversal order and changes for content additions, edits, and deletions', () => {
		const localRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-treedx-seed-'));
		const contentPath = 'docs/src/content';
		const objectives = join(localRoot, contentPath, 'objectives');
		const agents = join(localRoot, contentPath, 'agents');
		mkdirSync(objectives, { recursive: true });
		mkdirSync(agents, { recursive: true });
		writeFileSync(join(agents, 'zeta.mdx'), 'zeta\n');
		writeFileSync(join(objectives, 'alpha.md'), 'alpha\n');
		writeFileSync(join(objectives, 'ignored.txt'), 'ignored\n');
		const source = { localRoot, contentPath, seedPaths: [contentPath] };

		expect(collectLocalTreeDxSeedFiles(source).map((file) => file.path)).toEqual([
			'docs/src/content/agents/zeta.mdx',
			'docs/src/content/objectives/alpha.md',
		]);
		const initial = localTreeDxSeedDigest(source);
		expect(localTreeDxSeedDigest(source)).toBe(initial);
		writeFileSync(join(objectives, 'alpha.md'), 'changed\n');
		const edited = localTreeDxSeedDigest(source);
		expect(edited).not.toBe(initial);
		rmSync(join(agents, 'zeta.mdx'));
		expect(localTreeDxSeedDigest(source)).not.toBe(edited);
	});

	it('collects explicit repository manifest files beside content roots', () => {
		const localRoot = mkdtempSync(join(tmpdir(), 'treedx-seed-manifest-'));
		mkdirSync(join(localRoot, 'src/content'), { recursive: true });
		writeFileSync(join(localRoot, 'src/content/page.md'), '# Page\n');
		writeFileSync(join(localRoot, 'package.json'), '{"name":"example"}\n');
		try {
			expect(collectLocalTreeDxSeedFiles({ localRoot, contentPath: 'src/content', seedPaths: ['src/content', 'package.json'] }).map((file) => file.path)).toEqual(['package.json', 'src/content/page.md']);
		} finally {
			rmSync(localRoot, { recursive: true, force: true });
		}
	});

	it('requires every desired path to exist with byte-exact content', () => {
		const desired = [
			{ path: 'src/content/agents/engineer.mdx', content: 'engineer\n' },
			{ path: 'src/content/agents/researcher.mdx', content: 'researcher\n' },
		];

		expect(verifyLocalTreeDxSeedFiles(desired, desired)).toEqual({
			verified: true,
			desiredFileCount: 2,
			verifiedFileCount: 2,
			missingPaths: [],
			mismatchedPaths: [],
		});
		expect(verifyLocalTreeDxSeedFiles(desired, [
			{ path: 'src/content/agents/engineer.mdx', content: 'stale\n' },
		])).toEqual({
			verified: false,
			desiredFileCount: 2,
			verifiedFileCount: 0,
			missingPaths: ['src/content/agents/researcher.mdx'],
			mismatchedPaths: ['src/content/agents/engineer.mdx'],
		});
	});

	it('requires TreeDX to parse seeded Markdown frontmatter at the exact reconciled commit', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-local-treedx-frontmatter-'));
		const contentPath = 'src/content/knowledge';
		mkdirSync(join(root, contentPath), { recursive: true });
		writeFileSync(join(root, contentPath, 'guide.md'), '---\nid: guide.seed\ntitle: Seed Guide\n---\n\n# Seed Guide\n');
		const commit = 'a'.repeat(40);
		const client = {
			readRepositoryFiles: async (input: { parseFrontmatter?: boolean }) => ({ resolvedRef: commit, files: [{
				path: `${contentPath}/guide.md`, content: '---\nid: guide.seed\ntitle: Seed Guide\n---\n\n# Seed Guide\n',
				...(input.parseFrontmatter ? { frontmatter: { id: 'guide.seed', title: 'Seed Guide' }, body: '# Seed Guide\n' } : {}),
			}] }),
			getSearchIndexStatus: async () => ({ ready: true, stale: false, resolvedRef: commit, sourceCommit: commit, indexVersion: 'index-1', graphVersion: 'graph-1' }),
			searchRepositoryFiles: async () => ({ resolvedRef: commit, results: [] }),
			queryGraph: async () => ({ graphVersion: 'graph-1', results: [] }),
		};
		try {
			await expect(verifyLocalTreeDxProjectContent(client as never, {
				slug: 'guide', repositoryName: 'guide', localRoot: root, contentPath,
				seedPaths: [contentPath], defaultRef: 'refs/heads/main',
			}, 'repo-guide')).resolves.toMatchObject({ verified: true, frontmatterVerified: true, resolvedRef: commit });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('retries a transient shared-cache load timeout during content verification', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-local-treedx-cache-retry-'));
		mkdirSync(join(root, 'src/content'), { recursive: true });
		writeFileSync(join(root, 'src/content/page.md'), '# Page\n');
		const commit = 'b'.repeat(40);
		let graphAttempts = 0;
		const client = {
			readRepositoryFiles: async () => ({ resolvedRef: commit, files: [{ path: 'src/content/page.md', content: '# Page\n' }] }),
			getSearchIndexStatus: async () => ({ ready: true, stale: false, resolvedRef: commit, sourceCommit: commit, indexVersion: 'index-1', graphVersion: 'graph-1' }),
			searchRepositoryFiles: async () => ({ resolvedRef: commit, results: [] }),
			queryGraph: async () => {
				graphAttempts += 1;
				if (graphAttempts === 1) throw new Error('Timed out waiting for a shared cache load.');
				return { graphVersion: 'graph-1', results: [] };
			},
		};
		try {
			await expect(verifyLocalTreeDxProjectContent(client as never, {
				slug: 'page', repositoryName: 'page', localRoot: root, contentPath: 'src/content',
				seedPaths: ['src/content'], defaultRef: 'refs/heads/main',
			}, 'repo-page')).resolves.toMatchObject({ verified: true, resolvedRef: commit });
			expect(graphAttempts).toBe(2);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
