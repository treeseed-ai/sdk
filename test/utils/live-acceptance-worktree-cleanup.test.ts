import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupLocalAcceptanceAgentWorktrees } from '../../src/reconcile/live-acceptance-worktree-cleanup.ts';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('local acceptance assignment-worktree cleanup', () => {
	it('uses the guarded SDK release operation for registered starter worktrees only', async () => {
		const workspaceRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-live-worktree-cleanup-'));
		roots.push(workspaceRoot);
		const repoRoot = resolve(workspaceRoot, 'starters/engineering');
		mkdirSync(repoRoot, { recursive: true });
		writeFileSync(resolve(repoRoot, 'README.md'), 'starter\n');
		execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot, stdio: 'ignore' });
		execFileSync('git', ['config', 'user.email', 'acceptance@example.test'], { cwd: repoRoot });
		execFileSync('git', ['config', 'user.name', 'Acceptance'], { cwd: repoRoot });
		execFileSync('git', ['add', '.'], { cwd: repoRoot });
		execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repoRoot, stdio: 'ignore' });
		const worktreeRoot = resolve(repoRoot, '.agent-worktrees/agent/tester/assignment-a');
		mkdirSync(resolve(worktreeRoot, '..'), { recursive: true });
		execFileSync('git', ['worktree', 'add', '-b', 'agent/tester/assignment-a', worktreeRoot, 'HEAD'], { cwd: repoRoot, stdio: 'ignore' });

		const result = await cleanupLocalAcceptanceAgentWorktrees(workspaceRoot);

		expect(result).toEqual({ removed: [{ repoRoot, worktreeRoot }], failures: [] });
		expect(readFileSync(resolve(repoRoot, 'README.md'), 'utf8')).toBe('starter\n');
		expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' })).not.toContain(worktreeRoot);
	});
});
