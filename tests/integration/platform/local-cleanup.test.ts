import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTreeseedLocalCleanup } from '../../../src/operations/services/local-cleanup.ts';

describe('local cleanup', () => {
	it('removes abandoned npm downloads without deleting reusable cache content or evidence', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-cleanup-'));
		const npmCacheRoot = join(root, 'npm-cache');
		const temporaryDownload = join(npmCacheRoot, '_cacache', 'tmp', 'partial-package');
		const reusableContent = join(npmCacheRoot, '_cacache', 'content-v2', 'package');
		const evidence = join(root, '.treeseed', 'workflow', 'attestations', 'candidate.json');
		for (const path of [temporaryDownload, reusableContent, evidence]) mkdirSync(join(path, '..'), { recursive: true });
		writeFileSync(temporaryDownload, 'partial');
		writeFileSync(reusableContent, 'reusable');
		writeFileSync(evidence, '{}');

		const report = runTreeseedLocalCleanup({ root, mode: 'standard', npmCacheRoot });

		expect(report.ok).toBe(true);
		expect(report.reclaimedBytes).toBeGreaterThan(0);
		expect(report.actions).toContainEqual(expect.objectContaining({
			id: 'npm-cache-temporary-downloads',
			status: 'removed',
		}));
		expect(existsSync(temporaryDownload)).toBe(false);
		expect(existsSync(reusableContent)).toBe(true);
		expect(existsSync(evidence)).toBe(true);
	});

	it('preserves scene runs and matrix evidence during aggressive cleanup', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-cleanup-evidence-'));
		const sceneRun = join(root, '.treeseed', 'scenes', 'runs', 'run-1', 'report.json');
		const matrix = join(root, '.treeseed', 'scenes', 'matrix', 'matrix.json');
		const render = join(root, '.treeseed', 'scenes', 'render', 'temporary.mp4');
		for (const path of [sceneRun, matrix, render]) {
			mkdirSync(join(path, '..'), { recursive: true });
			writeFileSync(path, '{}');
		}

		const report = runTreeseedLocalCleanup({ root, mode: 'aggressive', docker: false });

		expect(report.ok).toBe(true);
		expect(existsSync(sceneRun)).toBe(true);
		expect(existsSync(matrix)).toBe(true);
		expect(existsSync(render)).toBe(false);
	});

	it('removes caches from independent workspace repositories while preserving their evidence', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-cleanup-workspace-'));
		const packageRoot = join(root, 'packages', 'api');
		const cache = join(packageRoot, '.treeseed', 'cache', 'npm', 'stale-clone');
		const evidence = join(packageRoot, '.treeseed', 'scenes', 'runs', 'run-1', 'report.json');
		mkdirSync(join(packageRoot, '.git'), { recursive: true });
		for (const path of [cache, evidence]) {
			mkdirSync(join(path, '..'), { recursive: true });
			writeFileSync(path, '{}');
		}

		const report = runTreeseedLocalCleanup({ root, mode: 'standard' });

		expect(report.ok).toBe(true);
		expect(report.actions).toContainEqual(expect.objectContaining({
			id: 'packages/api:.treeseed/cache',
			status: 'removed',
		}));
		expect(existsSync(cache)).toBe(false);
		expect(existsSync(evidence)).toBe(true);
	});
});
