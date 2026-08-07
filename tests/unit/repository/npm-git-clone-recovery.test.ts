import { existsSync,mkdirSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { runWithStaleNpmGitCloneRetry,staleNpmGitClonePath } from '../../../src/operations/services/runtime/npm-git-clone-recovery.ts';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true,force: true });
});

describe('npm Git clone recovery', () => {
	it('recognizes current clone-root and historical .git npm failures only inside the cache', () => {
		const cloneRoot = '/tmp/project/.treeseed/cache/npm/_cacache/tmp/git-cloneABC';
		expect(staleNpmGitClonePath(`fatal: destination path '${cloneRoot}' already exists and is not an empty directory.`)).toBe(cloneRoot);
		expect(staleNpmGitClonePath(`fatal: destination path '${cloneRoot}/.git' already exists and is not an empty directory.`)).toBe(cloneRoot);
		expect(staleNpmGitClonePath("fatal: destination path '/tmp/git-cloneABC' already exists and is not an empty directory.")).toBeNull();
	});

	it('removes only the interrupted clone and retries once', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'npm-clone-recovery-'));
		roots.push(root);
		const cloneRoot = resolve(root, '_cacache', 'tmp', 'git-cloneABC');
		mkdirSync(cloneRoot, { recursive: true });
		const run = vi.fn()
			.mockReturnValueOnce({ status: 128,detail: `fatal: destination path '${cloneRoot}' already exists and is not an empty directory.` })
			.mockReturnValueOnce({ status: 0,detail: '' });
		const recovered = runWithStaleNpmGitCloneRetry({
			run,
			failureDetail: (attempt) => attempt.status === 0 ? null : attempt.detail,
		});

		expect(run).toHaveBeenCalledTimes(2);
		expect(recovered.result.status).toBe(0);
		expect(recovered.retriedPath).toBe(cloneRoot);
		expect(existsSync(cloneRoot)).toBe(false);
	});
});
