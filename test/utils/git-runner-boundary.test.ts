import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { filesUnderIfExists, resolveTreeseedTestPath, resolveTreeseedTestRoot, treeseedRelativePath } from './workspace-test-root.ts';

const testRoot = resolveTreeseedTestRoot(import.meta.url);

describe('GitRunner boundary', () => {
	it('keeps production raw git process calls inside GitRunner', () => {
		const offenders = [
			...filesUnderIfExists(resolveTreeseedTestPath(testRoot, 'packages/sdk/src')),
			...filesUnderIfExists(resolveTreeseedTestPath(testRoot, 'packages/cli/src')),
			...filesUnderIfExists(resolveTreeseedTestPath(testRoot, 'packages/core/src')),
		].flatMap((file) => {
			const path = treeseedRelativePath(testRoot, file);
			if (path === 'packages/sdk/src/operations/services/git-runner.ts') return [];
			const source = readFileSync(file, 'utf8');
			const matches = [
				/run\('git'/u,
				/run\(\['git'\]\[0\]/u,
				/spawnSync\('git'/u,
				/spawnSync\("git"/u,
				/execFileSync\('git'/u,
				/execFileSync\("git"/u,
			].filter((pattern) => pattern.test(source));
			return matches.length > 0 ? [path] : [];
		});
		expect(offenders).toEqual([]);
	});
});
