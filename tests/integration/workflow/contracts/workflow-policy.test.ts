import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWorkflowPaths } from '../../../../src/workflow/policy.ts';

describe('workflow path policy', () => {
	it('does not resolve invalid managed worktree directories to the parent project', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-workflow-policy-'));
		writeFileSync(resolve(root, 'treeseed.site.yaml'), 'name: Demo\nslug: demo\n', 'utf8');
		const invalidWorktree = resolve(root, '.treeseed', 'worktrees', 'feature-demo');
		mkdirSync(invalidWorktree, { recursive: true });

		const resolved = resolveWorkflowPaths(invalidWorktree);

		expect(resolved.requestedCwd).toBe(invalidWorktree);
		expect(resolved.cwd).toBe(invalidWorktree);
		expect(resolved.tenantRoot).toBeNull();
		expect(resolved.repoRoot).toBeNull();
		expect(resolved.branchRole).toBe('none');
	});

	it('still resolves valid managed worktrees that contain their own tenant config', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-workflow-policy-'));
		writeFileSync(resolve(root, 'treeseed.site.yaml'), 'name: Demo\nslug: demo\n', 'utf8');
		const validWorktree = resolve(root, '.treeseed', 'worktrees', 'feature-demo');
		mkdirSync(validWorktree, { recursive: true });
		writeFileSync(resolve(validWorktree, 'treeseed.site.yaml'), 'name: Demo\nslug: demo\n', 'utf8');

		const resolved = resolveWorkflowPaths(validWorktree);

		expect(resolved.cwd).toBe(validWorktree);
		expect(resolved.tenantRoot).toBe(validWorktree);
	});
});
