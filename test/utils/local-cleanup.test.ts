import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTreeseedLocalCleanup } from '../../src/operations/services/local-cleanup.ts';

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
});
