import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planProjectCleanup, pruneRecoveryCaches, runProjectCleanup } from '../../../../src/operations/services/runtime/local-cleanup.ts';

describe('recovery cache pruning', () => {
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

		const report = pruneRecoveryCaches({ root, mode: 'standard', npmCacheRoot });

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

		const report = pruneRecoveryCaches({ root, mode: 'aggressive', docker: false });

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

		const report = pruneRecoveryCaches({ root, mode: 'standard' });

		expect(report.ok).toBe(true);
		expect(report.actions).toContainEqual(expect.objectContaining({
			id: 'packages/api:.treeseed/cache',
			status: 'removed',
		}));
		expect(existsSync(cache)).toBe(false);
		expect(existsSync(evidence)).toBe(true);
	});
});

describe('project cleanup', () => {
	it('plans and removes generated project data while preserving durable and operator state', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-project-cleanup-'));
		const packageRoot = join(root, 'packages', 'api');
		const sceneRun = join(root, '.treeseed', 'scenes', 'runs', 'scene-1', 'run-1');
		const generated = [
			join(sceneRun, 'report.json'),
			join(root, '.treeseed', 'logs', 'platform.log'),
			join(root, '.treeseed', 'exports', 'snapshot.md'),
			join(packageRoot, '.treeseed', 'docker', 'runtime', 'node_modules', 'package', 'index.js'),
			join(root, 'dist', 'index.js'),
		];
		const preserved = [
			join(root, '.treeseed', 'config', 'config.json'),
			join(root, '.treeseed', 'workflow', 'runs', 'stage-current', 'journal.json'),
			join(root, '.treeseed', 'worktrees', 'sibling', 'state.json'),
			join(root, '.treeseed', 'local-api-postgres', 'data'),
			join(root, 'node_modules', '.bin', 'trsd'),
			join(packageRoot, 'dist', 'index.js'),
			join(packageRoot, 'src', 'index.ts'),
		];
		mkdirSync(packageRoot, { recursive: true });
		writeFileSync(join(packageRoot, 'package.json'), '{}');
		for (const path of [...generated, ...preserved]) {
			mkdirSync(join(path, '..'), { recursive: true });
			writeFileSync(path, 'data');
		}
		writeFileSync(join(sceneRun, 'run.json'), JSON.stringify({ finishedAt: new Date().toISOString() }));

		const plan = planProjectCleanup({ root });

		expect(plan.ok).toBe(true);
		expect(plan.executionMode).toBe('plan');
		expect(plan.beforeBytes).toBeGreaterThan(0);
		for (const path of generated) expect(existsSync(path)).toBe(true);

		const report = runProjectCleanup({ root });

		expect(report.ok).toBe(true);
		expect(report.reclaimedBytes).toBeGreaterThan(0);
		for (const path of generated) expect(existsSync(path)).toBe(false);
		for (const path of preserved) expect(existsSync(path)).toBe(true);
	});

	it('blocks deletion when a scene run is recent and unfinished', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-project-cleanup-active-'));
		const sceneRun = join(root, '.treeseed', 'scenes', 'runs', 'scene-1', 'run-1');
		const log = join(root, '.treeseed', 'logs', 'platform.log');
		for (const path of [join(sceneRun, 'run.json'), log]) {
			mkdirSync(join(path, '..'), { recursive: true });
			writeFileSync(path, path.endsWith('run.json') ? JSON.stringify({ startedAt: new Date().toISOString() }) : 'data');
		}

		const report = runProjectCleanup({ root });

		expect(report.ok).toBe(false);
		expect(report.blockers).toEqual([sceneRun]);
		expect(report.actions).toContainEqual(expect.objectContaining({ status: 'blocked', path: sceneRun }));
		expect(existsSync(sceneRun)).toBe(true);
		expect(existsSync(log)).toBe(true);
	});

	it('aggressive mode removes package closures and stale indexes without removing the root CLI or current journals', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-project-cleanup-aggressive-'));
		const packageRoot = join(root, 'packages', 'treedx');
		const removed = [
			join(packageRoot, 'node_modules', 'package', 'index.js'),
			join(packageRoot, 'target', 'debug', 'binary'),
			join(packageRoot, 'packages', 'rust-sdk', 'target', 'debug', 'library'),
			join(root, '.treeseed', 'local-treedx', 'data', 'index'),
			join(root, '.treeseed', 'workflow', 'runs', 'archived-old', 'journal.json'),
		];
		const preserved = [
			join(root, 'node_modules', '.bin', 'trsd'),
			join(root, '.treeseed', 'workflow', 'runs', 'stage-current', 'journal.json'),
		];
		mkdirSync(packageRoot, { recursive: true });
		writeFileSync(join(packageRoot, 'package.json'), '{}');
		for (const path of [...removed, ...preserved]) {
			mkdirSync(join(path, '..'), { recursive: true });
			writeFileSync(path, 'data');
		}

		const report = runProjectCleanup({ root, mode: 'aggressive' });

		expect(report.ok).toBe(true);
		for (const path of removed) expect(existsSync(path)).toBe(false);
		for (const path of preserved) expect(existsSync(path)).toBe(true);
	});
});
