import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { remoteBranchExistsSafe } from '../../../../src/operations/services/repositories/repository-save-orchestrator.ts';

function git(cwd: string, args: string[]) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
	}
	return result.stdout.trim();
}

describe('repository save remote branch observation', () => {
	it('ignores stale tracking refs after the canonical origin changes', () => {
		const oldOrigin = mkdtempSync(join(tmpdir(), 'treeseed-save-old-origin-'));
		const newOrigin = mkdtempSync(join(tmpdir(), 'treeseed-save-new-origin-'));
		const source = mkdtempSync(join(tmpdir(), 'treeseed-save-source-'));
		const checkout = mkdtempSync(join(tmpdir(), 'treeseed-save-checkout-'));
		const branch = 'migration/organization';

		git(oldOrigin, ['init', '--bare']);
		git(newOrigin, ['init', '--bare']);
		git(source, ['init', '-b', branch]);
		git(source, ['config', 'user.email', 'test@example.com']);
		git(source, ['config', 'user.name', 'Test User']);
		writeFileSync(resolve(source, 'README.md'), 'old organization\n', 'utf8');
		git(source, ['add', 'README.md']);
		git(source, ['commit', '-m', 'chore: initialize branch']);
		git(source, ['remote', 'add', 'origin', oldOrigin]);
		git(source, ['push', '-u', 'origin', branch]);

		git(checkout, ['clone', '--branch', branch, oldOrigin, '.']);
		expect(git(checkout, ['rev-parse', '--verify', `refs/remotes/origin/${branch}`])).toMatch(/^[0-9a-f]{40}$/u);
		git(checkout, ['remote', 'set-url', 'origin', newOrigin]);

		expect(remoteBranchExistsSafe(checkout, branch)).toBe(false);
	});
});
