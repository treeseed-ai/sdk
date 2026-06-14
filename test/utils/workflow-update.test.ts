import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TreeseedWorkflowError, TreeseedWorkflowSdk } from '../../src/workflow.ts';

function git(cwd: string, args: string[], options: { allowFailure?: boolean } = {}) {
	const result = spawnSync('git', args, {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: '/dev/null',
			GIT_ALLOW_PROTOCOL: 'file:git:ssh:https',
		},
	});
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}
	return {
		status: result.status ?? 1,
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
	};
}

function commitFile(repo: string, file: string, content: string, message: string) {
	writeFileSync(resolve(repo, file), content, 'utf8');
	git(repo, ['add', '-A']);
	git(repo, ['commit', '-m', message]);
}

function createRootRepo() {
	const temp = mkdtempSync(join(tmpdir(), 'treeseed-update-'));
	const origin = resolve(temp, 'origin.git');
	const work = resolve(temp, 'work');
	git(temp, ['init', '--bare', origin]);
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
	git(work, ['checkout', '-b', 'demo']);
	git(work, ['push', '-u', 'origin', 'demo']);
	return { temp, origin, work };
}

function createPackageRepo(temp: string, name: string, manifestOnly = false) {
	const origin = resolve(temp, `${name}.git`);
	const work = resolve(temp, `${name}-work`);
	git(temp, ['init', '--bare', origin]);
	mkdirSync(work, { recursive: true });
	git(work, ['init', '-b', 'staging']);
	git(work, ['config', 'user.name', 'Treeseed Test']);
	git(work, ['config', 'user.email', 'treeseed@example.com']);
	writeFileSync(resolve(work, 'package.json'), manifestOnly ? '{}\n' : JSON.stringify({ name: `@treeseed/${name}`, version: '1.0.0' }, null, 2), 'utf8');
	if (manifestOnly) {
		writeFileSync(resolve(work, 'treeseed.package.yaml'), `id: ${name}
name: TreeDX
kind: beam-elixir-rust
repository: treeseed-ai/${name}
publishTarget: treeseed/${name}
artifacts:
  - provider: docker
    name: treeseed/${name}
    dockerfile: Dockerfile
    context: .
    architectures:
      - amd64
      - arm64
`, 'utf8');
	}
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', `init ${name}`]);
	git(work, ['remote', 'add', 'origin', origin]);
	git(work, ['push', '-u', 'origin', 'staging']);
	git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/staging']);
	git(work, ['checkout', '-b', 'demo']);
	git(work, ['push', '-u', 'origin', 'demo']);
	return { origin, work };
}

async function runUpdate(cwd: string, input: Parameters<TreeseedWorkflowSdk['update']>[0]) {
	const sdk = new TreeseedWorkflowSdk({
		cwd,
		env: {
			...process.env,
			TREESEED_WORKSPACE_LINKS: 'off',
		},
		write: () => {},
	});
	return sdk.update({ workspaceLinks: 'off', ...input });
}

describe('workflow update', () => {
	it('plans an update without mutating the task branch', async () => {
		const { work } = createRootRepo();
		const before = git(work, ['rev-parse', 'HEAD']).stdout;
		git(work, ['checkout', 'staging']);
		commitFile(work, 'staging.txt', 'new staging\n', 'advance staging');
		git(work, ['push', 'origin', 'staging']);
		git(work, ['checkout', 'demo']);

		const result = await runUpdate(work, { from: 'staging', plan: true });

		expect(result.executionMode).toBe('plan');
		expect(git(work, ['rev-parse', 'HEAD']).stdout).toBe(before);
		expect((result.payload as { rootRepo: { status: string } }).rootRepo.status).toBe('merge-needed');
	});

	it('refuses to run from staging', async () => {
		const { work } = createRootRepo();
		git(work, ['checkout', 'staging']);

		await expect(runUpdate(work, { from: 'staging' })).rejects.toMatchObject({
			code: 'validation_failed',
		});
	});

	it('refuses dirty repositories', async () => {
		const { work } = createRootRepo();
		writeFileSync(resolve(work, 'dirty.txt'), 'dirty\n', 'utf8');

		await expect(runUpdate(work, { from: 'staging' })).rejects.toMatchObject({
			code: 'validation_failed',
		});
	});

	it('merges staging into a root-only task branch and pushes by default', async () => {
		const { origin, work } = createRootRepo();
		git(work, ['checkout', 'staging']);
		commitFile(work, 'staging.txt', 'new staging\n', 'advance staging');
		const stagingHead = git(work, ['rev-parse', 'HEAD']).stdout;
		git(work, ['push', 'origin', 'staging']);
		git(work, ['checkout', 'demo']);

		const result = await runUpdate(work, { from: 'staging' });

		expect(result.ok).toBe(true);
		expect(git(work, ['merge-base', '--is-ancestor', stagingHead, 'HEAD'], { allowFailure: true }).status).toBe(0);
		expect(git(origin, ['rev-parse', 'refs/heads/demo']).stdout).toBe(git(work, ['rev-parse', 'HEAD']).stdout);
	});

	it('blocks ff-only when a merge commit would be required', async () => {
		const { work } = createRootRepo();
		commitFile(work, 'demo.txt', 'demo\n', 'demo work');
		git(work, ['push', 'origin', 'demo']);
		git(work, ['checkout', 'staging']);
		commitFile(work, 'staging.txt', 'staging\n', 'staging work');
		git(work, ['push', 'origin', 'staging']);
		git(work, ['checkout', 'demo']);

		await expect(runUpdate(work, { from: 'staging', strategy: 'ff-only' })).rejects.toMatchObject({
			code: 'merge_conflict',
		});
	});

	it('updates manifest-only TreeDX package branches before root pointers', async () => {
		const { temp, work } = createRootRepo();
		const treedx = createPackageRepo(temp, 'treedx', true);
		git(work, ['checkout', 'staging']);
		writeFileSync(
			resolve(work, 'package.json'),
			JSON.stringify({ name: 'demo', version: '1.0.0', workspaces: ['packages/*'] }, null, 2),
			'utf8',
		);
		git(work, ['-c', 'protocol.file.allow=always', 'submodule', 'add', treedx.origin, 'packages/treedx']);
		git(work, ['add', '-A']);
		git(work, ['commit', '-m', 'add treedx']);
		git(work, ['push', 'origin', 'staging']);
		git(work, ['checkout', 'demo']);
		git(work, ['merge', '--no-edit', 'origin/staging']);
		git(work, ['submodule', 'update', '--init', '--recursive']);
		git(resolve(work, 'packages/treedx'), ['checkout', 'demo']);
		git(work, ['push', 'origin', 'demo']);

		git(treedx.work, ['checkout', 'staging']);
		commitFile(treedx.work, 'staging.txt', 'treedx staging\n', 'advance treedx staging');
		const treedxStaging = git(treedx.work, ['rev-parse', 'HEAD']).stdout;
		git(treedx.work, ['push', 'origin', 'staging']);
		git(work, ['checkout', 'staging']);
		git(resolve(work, 'packages/treedx'), ['fetch', 'origin']);
		git(resolve(work, 'packages/treedx'), ['checkout', 'staging']);
		git(resolve(work, 'packages/treedx'), ['merge', '--ff-only', 'origin/staging']);
		git(work, ['add', 'packages/treedx']);
		git(work, ['commit', '-m', 'update treedx pointer']);
		git(work, ['push', 'origin', 'staging']);
		git(work, ['checkout', 'demo']);
		git(resolve(work, 'packages/treedx'), ['checkout', 'demo']);

		const result = await runUpdate(work, { from: 'staging' });

		expect(result.ok).toBe(true);
		expect(git(resolve(work, 'packages/treedx'), ['branch', '--show-current']).stdout).toBe('demo');
		expect(git(resolve(work, 'packages/treedx'), ['merge-base', '--is-ancestor', treedxStaging, 'HEAD'], { allowFailure: true }).status).toBe(0);
		expect(git(work, ['status', '--porcelain']).stdout).toBe('');
	});

	it('stops on the first merge conflict and reports conflicted files', async () => {
		const { work } = createRootRepo();
		commitFile(work, 'conflict.txt', 'demo\n', 'demo conflict');
		git(work, ['push', 'origin', 'demo']);
		git(work, ['checkout', 'staging']);
		commitFile(work, 'conflict.txt', 'staging\n', 'staging conflict');
		git(work, ['push', 'origin', 'staging']);
		git(work, ['checkout', 'demo']);

		let error: unknown = null;
		try {
			await runUpdate(work, { from: 'staging' });
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(TreeseedWorkflowError);
		expect((error as TreeseedWorkflowError).code).toBe('merge_conflict');
		expect((error as TreeseedWorkflowError).details?.files).toContain('conflict.txt');
		expect(existsSync(resolve(work, 'conflict.txt'))).toBe(true);
	});
});
