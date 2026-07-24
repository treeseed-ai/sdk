import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { filesUnderIfExists, resolveTestPath, resolveTestRoot, RelativePath } from '../../support/workspace-test-root.ts';

const testRoot = resolveTestRoot(import.meta.url);

describe('GitRunner boundary', () => {
	it('keeps production raw git process calls inside GitRunner', () => {
		const offenders = [
			...filesUnderIfExists(resolveTestPath(testRoot, 'packages/sdk/src')),
			...filesUnderIfExists(resolveTestPath(testRoot, 'packages/cli/src')),
			...filesUnderIfExists(resolveTestPath(testRoot, 'packages/core/src')),
		].flatMap((file) => {
			const path = RelativePath(testRoot, file);
			if (path === 'packages/sdk/src/operations/services/operations/git-runner.ts'
				|| path.startsWith('packages/sdk/src/operations/services/git-runner/')) return [];
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
