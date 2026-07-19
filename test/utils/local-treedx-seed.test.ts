import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	collectLocalTreeDxSeedFiles,
	localTreeDxSeedDigest,
	verifyLocalTreeDxSeedFiles,
} from '../../src/platform/local-treedx-seed.ts';

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
		const source = { localRoot, contentPath, seedPaths: [`${contentPath}/objectives`, `${contentPath}/agents`] };

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
});
