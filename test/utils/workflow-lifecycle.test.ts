import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeseedWorkflowSdk } from '../../src/workflow.ts';

function git(cwd: string, args: string[]) {
	const result = spawnSync('git', args, {
		cwd,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}
	return result.stdout.trim();
}

function writeTenantFiles(root: string) {
	mkdirSync(resolve(root, 'src', 'content'), { recursive: true });
	writeFileSync(resolve(root, 'src', 'manifest.yaml'), 'id: demo\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n', 'utf8');
	writeFileSync(resolve(root, 'src', 'config.yaml'), 'site:\n  title: Demo\n', 'utf8');
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({
		name: 'workflow-demo',
		version: '1.0.0',
		private: true,
		workspaces: [],
	}, null, 2), 'utf8');
	writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: Demo
slug: demo
siteUrl: https://demo.example.com
contactEmail: demo@example.com
cloudflare:
  accountId: replace-with-cloudflare-account-id
providers:
  deploy: cloudflare
`, 'utf8');
	writeFileSync(resolve(root, 'README.md'), '# Demo\n', 'utf8');
}

function createWorkflowRepo() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-workflow-lifecycle-'));
	const origin = resolve(root, 'origin.git');
	const work = resolve(root, 'work');
	mkdirSync(work, { recursive: true });
	git(root, ['init', '--bare', origin]);
	git(work, ['init', '-b', 'staging']);
	git(work, ['config', 'user.name', 'Treeseed Test']);
	git(work, ['config', 'user.email', 'treeseed@example.com']);
	writeTenantFiles(work);
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', 'init']);
	git(work, ['remote', 'add', 'origin', origin]);
	git(work, ['push', '-u', 'origin', 'staging']);
	git(work, ['checkout', '-b', 'main']);
	git(work, ['push', '-u', 'origin', 'main']);
	git(work, ['checkout', '-b', 'feature/demo-task']);
	writeFileSync(resolve(work, 'feature.txt'), 'demo\n', 'utf8');
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', 'feat: demo']);
	git(work, ['push', '-u', 'origin', 'feature/demo-task']);
	return { work };
}

describe('treeseed workflow lifecycle', () => {
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-workflow-home-')));
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('resolves status from nested directories against the tenant root', async () => {
		const { work } = createWorkflowRepo();
		const nested = resolve(work, 'src', 'content');
		const workflow = new TreeseedWorkflowSdk({ cwd: nested });

		const result = await workflow.status();

		expect(result.ok).toBe(true);
		expect(result.payload.cwd).toBe(work);
		expect(result.payload.branchName).toBe('feature/demo-task');
	});

	it('treats save with no new changes as a successful sync checkpoint', async () => {
		const { work } = createWorkflowRepo();
		const workflow = new TreeseedWorkflowSdk({ cwd: work });

		const result = await workflow.save({
			message: 'chore: checkpoint',
			verify: false,
			refreshPreview: false,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.noChanges).toBe(true);
		expect(result.payload.branchSync.pushed).toBe(true);
		expect(result.payload.finalState.branchName).toBe('feature/demo-task');
	});

	it('auto-saves dirty task branches during close and returns to staging', async () => {
		const { work } = createWorkflowRepo();
		writeFileSync(resolve(work, 'feature.txt'), 'demo\nupdated\n', 'utf8');
		const workflow = new TreeseedWorkflowSdk({ cwd: work });

		const result = await workflow.close({
			message: 'superseded by another task',
		});

		expect(result.ok).toBe(true);
		expect(result.payload.autoSaved).toBe(true);
		expect(result.payload.finalBranch).toBe('staging');
		expect(result.payload.finalState.branchName).toBe('staging');
		expect(git(work, ['tag', '--list', 'deprecated/*'])).toContain('deprecated/feature-demo-task/');
	});
});
