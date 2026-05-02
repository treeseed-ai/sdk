import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
	ensureManagedWorkflowWorktree,
	managedWorkflowWorktreeMetadata,
	plannedManagedWorkflowWorktreePath,
	removeManagedWorkflowWorktree,
} from '../../src/workflow/worktrees.ts';
import { getTreeseedMachineConfigPaths } from '../../src/operations/services/config-runtime.ts';

function git(cwd: string, args: string[]) {
	const result = spawnSync('git', args, {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}
	return result.stdout.trim();
}

function createRepo() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-worktrees-'));
	const origin = resolve(root, 'origin.git');
	const work = resolve(root, 'work');
	git(root, ['init', '--bare', origin]);
	mkdirSync(work, { recursive: true });
	git(work, ['init', '-b', 'staging']);
	git(work, ['config', 'user.name', 'Treeseed Test']);
	git(work, ['config', 'user.email', 'treeseed@example.com']);
	writeFileSync(resolve(work, 'treeseed.site.yaml'), 'name: Demo\nslug: demo\n', 'utf8');
	writeFileSync(resolve(work, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2), 'utf8');
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', 'init']);
	git(work, ['remote', 'add', 'origin', origin]);
	git(work, ['push', '-u', 'origin', 'staging']);
	git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/staging']);
	return { root, origin, work };
}

function createPackageRepo(root: string, name: string) {
	const origin = resolve(root, `${name}.git`);
	const work = resolve(root, `${name}-work`);
	git(root, ['init', '--bare', origin]);
	mkdirSync(work, { recursive: true });
	git(work, ['init', '-b', 'staging']);
	git(work, ['config', 'user.name', 'Treeseed Test']);
	git(work, ['config', 'user.email', 'treeseed@example.com']);
	writeFileSync(resolve(work, 'package.json'), JSON.stringify({ name: `@treeseed/${name}`, version: '1.0.0' }, null, 2), 'utf8');
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', `init ${name}`]);
	git(work, ['remote', 'add', 'origin', origin]);
	git(work, ['push', '-u', 'origin', 'staging']);
	git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/staging']);
	return { origin, work };
}

describe('workflow managed worktrees', () => {
	it('creates and resumes a managed worktree from staging', () => {
		const { work } = createRepo();
		mkdirSync(resolve(work, '.treeseed', 'config'), { recursive: true });
		writeFileSync(resolve(work, '.treeseed', 'config', 'machine.yaml'), 'project:\n  slug: demo\n', 'utf8');
		const created = ensureManagedWorkflowWorktree({
			root: work,
			branchName: 'feature/search filters',
			mode: 'on',
		});

		expect(created.created).toBe(true);
		expect(created.worktreePath).toContain('.treeseed/worktrees/');
		expect(existsSync(resolve(created.worktreePath, 'treeseed.site.yaml'))).toBe(true);
		expect(readFileSync(resolve(created.worktreePath, '.treeseed', 'worktree.json'), 'utf8')).toContain('feature/search filters');

		const resumed = ensureManagedWorkflowWorktree({
			root: work,
			branchName: 'feature/search filters',
			mode: 'on',
		});

		expect(resumed.resumed).toBe(true);
		expect(resumed.worktreePath).toBe(created.worktreePath);
		expect(managedWorkflowWorktreeMetadata(created.worktreePath)?.branch).toBe('feature/search filters');
		expect(getTreeseedMachineConfigPaths(created.worktreePath).configPath)
			.toBe(resolve(work, '.treeseed', 'config', 'machine.yaml'));
	});

	it('creates package task branches from staging before workflow switch runs', () => {
		const { root, work } = createRepo();
		const sdk = createPackageRepo(root, 'sdk');
		writeFileSync(
			resolve(work, 'package.json'),
			JSON.stringify({ name: 'demo', version: '1.0.0', workspaces: ['packages/*'] }, null, 2),
			'utf8',
		);
		git(work, ['-c', 'protocol.file.allow=always', 'submodule', 'add', sdk.origin, 'packages/sdk']);
		git(work, ['config', 'protocol.file.allow', 'always']);
		git(work, ['add', '-A']);
		git(work, ['commit', '-m', 'add sdk submodule']);
		git(work, ['push', 'origin', 'staging']);

		const previousProtocol = process.env.GIT_ALLOW_PROTOCOL;
		process.env.GIT_ALLOW_PROTOCOL = 'file:git:ssh:https';
		let created: ReturnType<typeof ensureManagedWorkflowWorktree>;
		try {
			created = ensureManagedWorkflowWorktree({
				root: work,
				branchName: 'feature/submodule-worktree',
				mode: 'on',
			});
		} finally {
			if (previousProtocol == null) {
				delete process.env.GIT_ALLOW_PROTOCOL;
			} else {
				process.env.GIT_ALLOW_PROTOCOL = previousProtocol;
			}
		}

		expect(git(resolve(created.worktreePath, 'packages/sdk'), ['branch', '--show-current'])).toBe('feature/submodule-worktree');
	});

	it('rejects duplicate same-branch ownership in another active worktree', () => {
		const { work } = createRepo();
		git(work, ['branch', 'feature/duplicate', 'origin/staging']);
		const otherPath = resolve(work, '..', 'manual-duplicate');
		git(work, ['worktree', 'add', otherPath, 'feature/duplicate']);

		expect(() => ensureManagedWorkflowWorktree({
			root: work,
			branchName: 'feature/duplicate',
			mode: 'on',
		})).toThrow(/already checked out/u);
	});

	it('removes a managed worktree after successful cleanup', () => {
		const { work } = createRepo();
		const created = ensureManagedWorkflowWorktree({
			root: work,
			branchName: 'feature/remove-me',
			mode: 'on',
		});
		expect(plannedManagedWorkflowWorktreePath(work, 'feature/remove-me')).toBe(created.worktreePath);

		const removed = removeManagedWorkflowWorktree(created.worktreePath);

		expect(removed.removed).toBe(true);
		expect(existsSync(created.worktreePath)).toBe(false);
	});
});
