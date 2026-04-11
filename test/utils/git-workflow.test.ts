import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
	createDeprecatedTaskTag,
	listTaskBranches,
	taskTagSlug,
} from '../../src/operations/services/git-workflow.ts';

function git(cwd: string, args: string[]) {
	const result = spawnSync('git', args, {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
	}
	return result.stdout.trim();
}

function makeRepo() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-git-workflow-'));
	const origin = resolve(root, 'origin.git');
	const work = resolve(root, 'work');
	mkdirSync(work, { recursive: true });
	git(root, ['init', '--bare', origin]);
	git(work, ['init', '-b', 'staging']);
	git(work, ['config', 'user.name', 'Treeseed Test']);
	git(work, ['config', 'user.email', 'treeseed@example.com']);
	writeFileSync(resolve(work, 'README.md'), '# test\n', 'utf8');
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', 'init']);
	git(work, ['remote', 'add', 'origin', origin]);
	git(work, ['push', '-u', 'origin', 'staging']);
	git(work, ['checkout', '-b', 'main']);
	git(work, ['push', '-u', 'origin', 'main']);
	git(work, ['checkout', '-b', 'feature/search-filters']);
	writeFileSync(resolve(work, 'feature.txt'), 'search\n', 'utf8');
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', 'feat: search filters']);
	git(work, ['push', '-u', 'origin', 'feature/search-filters']);
	return { work };
}

describe('git workflow task helpers', () => {
	it('lists task branches while excluding staging, main, and deprecated tags', () => {
		const { work } = makeRepo();
		const tasks = listTaskBranches(work);

		expect(tasks.map((task) => task.name)).toEqual(['feature/search-filters']);
		expect(tasks[0]).toMatchObject({
			local: true,
			remote: true,
			current: true,
		});
		expect(tasks[0].head).toMatch(/^[0-9a-f]{40}$/);
	});

	it('creates and pushes a deprecated resurrection tag for a task branch', () => {
		const { work } = makeRepo();
		const result = createDeprecatedTaskTag(work, 'feature/search-filters', 'close: no longer needed');

		expect(result.tagName).toBe(`deprecated/${taskTagSlug('feature/search-filters')}/${result.head.slice(0, 12)}`);
		expect(git(work, ['rev-parse', `${result.tagName}^{}`])).toBe(result.head);
		expect(git(work, ['ls-remote', '--tags', 'origin', result.tagName])).toContain(result.tagName);
	});
});
