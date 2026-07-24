import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
	deleteRemoteBranchIfMerged,
	inspectMergedRemoteTaskBranches,
	listTaskBranches,
	mergeBranchDownIntoFeature,
	promoteCommitToBranchWithExpectedHead,
	shouldRetryFailedStagingAutomation,
	squashMergeBranchIntoStaging,
} from '../../../../src/operations/services/operations/git-workflow.ts';

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
	git(work, ['remote', 'set-head', 'origin', 'main']);
	git(work, ['checkout', '-b', 'feature/search-filters']);
	writeFileSync(resolve(work, 'feature.txt'), 'search\n', 'utf8');
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', 'feat: search filters']);
	git(work, ['push', '-u', 'origin', 'feature/search-filters']);
	return { work };
}

function makePackageRepo() {
	const packageRepo = mkdtempSync(join(tmpdir(), 'treeseed-git-workflow-package-'));
	git(packageRepo, ['init', '-b', 'main']);
	git(packageRepo, ['config', 'user.name', 'Treeseed Test']);
	git(packageRepo, ['config', 'user.email', 'treeseed@example.com']);
	writeFileSync(resolve(packageRepo, 'package.txt'), 'base\n', 'utf8');
	git(packageRepo, ['add', 'package.txt']);
	git(packageRepo, ['commit', '-m', 'base']);
	const base = git(packageRepo, ['rev-parse', 'HEAD']);

	writeFileSync(resolve(packageRepo, 'package.txt'), 'old\n', 'utf8');
	git(packageRepo, ['add', 'package.txt']);
	git(packageRepo, ['commit', '-m', 'old']);
	const old = git(packageRepo, ['rev-parse', 'HEAD']);

	git(packageRepo, ['checkout', '-b', 'new', base]);
	writeFileSync(resolve(packageRepo, 'package.txt'), 'new\n', 'utf8');
	git(packageRepo, ['add', 'package.txt']);
	git(packageRepo, ['commit', '-m', 'new']);
	const next = git(packageRepo, ['rev-parse', 'HEAD']);

	git(packageRepo, ['checkout', base]);
	return { packageRepo, base, old, next };
}

describe('git workflow task helpers', () => {
	it('deletes only the expected feature head after it is merged into staging', () => {
		const { work } = makeRepo();
		const featureHead = git(work, ['rev-parse', 'origin/feature/search-filters']);
		git(work, ['push', 'origin', `${featureHead}:refs/heads/staging`]);

		expect(deleteRemoteBranchIfMerged(work, 'feature/search-filters', 'staging', featureHead)).toBe(true);
		expect(git(work, ['ls-remote', '--heads', 'origin', 'feature/search-filters'])).toBe('');
	});

	it('refuses to delete a feature branch that is unmerged or moved', () => {
		const { work } = makeRepo();
		const featureHead = git(work, ['rev-parse', 'origin/feature/search-filters']);

		expect(() => deleteRemoteBranchIfMerged(work, 'feature/search-filters', 'staging', featureHead)).toThrow(/not merged/u);
		expect(() => deleteRemoteBranchIfMerged(work, 'feature/search-filters', 'staging', '0000000000000000000000000000000000000000')).toThrow(/expected/u);
		expect(git(work, ['ls-remote', '--heads', 'origin', 'feature/search-filters'])).toContain(featureHead);
	});

	it('classifies exact remote task heads by protected branch ancestry', () => {
		const { work } = makeRepo();
		const featureHead = git(work, ['rev-parse', 'origin/feature/search-filters']);
		git(work, ['push', 'origin', `${featureHead}:refs/heads/staging`]);
		git(work, ['checkout', 'staging']);
		git(work, ['reset', '--hard', 'origin/staging']);

		expect(inspectMergedRemoteTaskBranches(work)).toEqual([
			expect.objectContaining({
				branch: 'feature/search-filters',
				head: featureHead,
				current: false,
				mergedInto: 'staging',
			}),
		]);
	});

	it('retries only completed failed staging automation runs', () => {
		expect(shouldRetryFailedStagingAutomation('completed', 'failure')).toBe(true);
		expect(shouldRetryFailedStagingAutomation('completed', 'cancelled')).toBe(true);
		expect(shouldRetryFailedStagingAutomation('completed', 'success')).toBe(false);
		expect(shouldRetryFailedStagingAutomation('in_progress', null)).toBe(false);
		expect(shouldRetryFailedStagingAutomation(null, null)).toBe(false);
	});

	it('lists task branches while excluding staging, main, and deprecated tags', () => {
		const { work } = makeRepo();
		const tasks = listTaskBranches(work);
		const remoteRefs = git(work, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']).split('\n');

		expect(remoteRefs).toContain('origin');
		expect(tasks.map((task) => task.name)).toEqual(['feature/search-filters']);
		expect(tasks[0]).toMatchObject({
			local: true,
			remote: true,
			current: true,
		});
		expect(tasks[0].head).toMatch(/^[0-9a-f]{40}$/);
	});

	it('excludes deprecated branches from task branch listings', () => {
		const { work } = makeRepo();
		git(work, ['checkout', '-b', 'deprecated/feature-search-filters']);
		git(work, ['push', '-u', 'origin', 'deprecated/feature-search-filters']);

		const tasks = listTaskBranches(work);
		expect(tasks.map((task) => task.name)).toEqual(['feature/search-filters']);
	});

	it('lists a task branch whose name also exists as a worktree path', () => {
		const { work } = makeRepo();
		git(work, ['checkout', 'staging']);
		mkdirSync(resolve(work, 'scenes'));
		writeFileSync(resolve(work, 'scenes', 'README.md'), 'scene fixtures\n', 'utf8');
		git(work, ['add', 'scenes/README.md']);
		git(work, ['commit', '-m', 'test: add scenes path']);
		git(work, ['push', 'origin', 'staging']);
		git(work, ['checkout', '-b', 'scenes']);
		git(work, ['push', '-u', 'origin', 'scenes']);

		expect(listTaskBranches(work).find((task) => task.name === 'scenes')).toMatchObject({
			local: true,
			remote: true,
			current: true,
		});
	});

	it('resolves generated package metadata conflicts during repeated staging attempts', () => {
		const { work } = makeRepo();
		const packageRepo = makePackageRepo();
		const packageJsonPath = resolve(work, 'package.json');
		const lockfilePath = resolve(work, 'package-lock.json');
		const packagePointerPath = 'packages/sdk';
		const writeVersion = (version: string) => {
			writeFileSync(packageJsonPath, `${JSON.stringify({ name: '@treeseed/sdk', version }, null, 2)}\n`, 'utf8');
			writeFileSync(lockfilePath, `${JSON.stringify({
				name: '@treeseed/sdk',
				version,
				lockfileVersion: 3,
				requires: true,
				packages: {
					'': { name: '@treeseed/sdk', version },
				},
				}, null, 2)}\n`, 'utf8');
		};
		const writePackagePointer = (sha: string) => {
			git(resolve(work, packagePointerPath), ['checkout', sha]);
			git(work, ['add', packagePointerPath]);
		};

		git(work, ['checkout', 'staging']);
		writeVersion('0.1.0-dev.base');
		mkdirSync(resolve(work, 'packages'), { recursive: true });
		git(work, ['-c', 'protocol.file.allow=always', 'submodule', 'add', packageRepo.packageRepo, packagePointerPath]);
		git(work, ['add', 'package.json', 'package-lock.json', '.gitmodules', packagePointerPath]);
		git(work, ['commit', '-m', 'stage: base generated metadata']);

		writeVersion('0.1.0-dev.old');
		writePackagePointer(packageRepo.old);
		git(work, ['add', 'package.json', 'package-lock.json', packagePointerPath]);
		git(work, ['commit', '-m', 'stage: old generated metadata']);
		git(work, ['push', 'origin', 'staging']);

		git(work, ['checkout', '-b', 'feature/generated-metadata', 'HEAD~1']);
		writeVersion('0.1.0-dev.new');
		writePackagePointer(packageRepo.next);
		git(work, ['add', 'package.json', 'package-lock.json', packagePointerPath]);
		git(work, ['commit', '-m', 'feat: new generated metadata']);
		git(work, ['push', '-u', 'origin', 'feature/generated-metadata']);

		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const result = squashMergeBranchIntoStaging(work, 'feature/generated-metadata', 'stage generated metadata', { pushTarget: false });

		expect(result.committed).toBe(true);
		expect(log).toHaveBeenCalledWith('Resolving generated package metadata reconciliation for package-lock.json, package.json, packages/sdk.');
		log.mockRestore();
		expect(result.generatedMetadataReconciliation).toMatchObject({
			targetBranch: 'staging',
			reconciledFiles: ['package-lock.json', 'package.json', packagePointerPath],
			allConflictsWereGeneratedMetadata: true,
			commitSha: result.commitSha,
		});
		expect(JSON.parse(git(work, ['show', 'HEAD:package.json'])).version).toBe('0.1.0-dev.new');
		expect(git(work, ['ls-tree', 'HEAD', packagePointerPath])).toContain(packageRepo.next);
		expect(git(work, ['diff', '--name-only', '--diff-filter=U'])).toBe('');
	});

	it('keeps non-generated squash conflicts as hard failures with conflicted paths', () => {
		const { work } = makeRepo();

		git(work, ['checkout', 'staging']);
		writeFileSync(resolve(work, 'README.md'), '# staging\n', 'utf8');
		git(work, ['add', 'README.md']);
		git(work, ['commit', '-m', 'stage: readme edit']);

		git(work, ['checkout', '-b', 'feature/readme-conflict', 'HEAD~1']);
		writeFileSync(resolve(work, 'README.md'), '# feature\n', 'utf8');
		git(work, ['add', 'README.md']);
		git(work, ['commit', '-m', 'feat: readme edit']);

		expect(() => squashMergeBranchIntoStaging(work, 'feature/readme-conflict', 'stage readme conflict', { pushTarget: false }))
			.toThrow(/README\.md|CONFLICT/u);
		expect(git(work, ['diff', '--name-only', '--diff-filter=U'])).toBe('');
		expect(git(work, ['status', '--porcelain'])).toBe('');
	});

	it('merges staging down into the feature branch and pushes the integrated head', () => {
		const { work } = makeRepo();

		git(work, ['checkout', 'staging']);
		writeFileSync(resolve(work, 'staging.txt'), 'staging change\n', 'utf8');
		git(work, ['add', 'staging.txt']);
		git(work, ['commit', '-m', 'stage: add staging file']);
		git(work, ['push', 'origin', 'staging']);

		const result = mergeBranchDownIntoFeature(work, {
			featureBranch: 'feature/search-filters',
			sourceBranch: 'staging',
			message: 'integrate staging',
			allowGeneratedMetadataAutoResolution: true,
		});

		expect(result.merged).toBe(true);
		expect(git(work, ['branch', '--show-current'])).toBe('feature/search-filters');
		expect(git(work, ['show', 'HEAD:staging.txt'])).toBe('staging change');
		expect(git(work, ['rev-parse', 'origin/feature/search-filters'])).toBe(result.afterHead);
	});

	it('refuses exact staging promotion when the remote staging head moved', () => {
		const { work } = makeRepo();
		const before = git(work, ['rev-parse', 'origin/staging']);
		const featureHead = git(work, ['rev-parse', 'feature/search-filters']);

		git(work, ['checkout', 'staging']);
		writeFileSync(resolve(work, 'staging-moved.txt'), 'moved\n', 'utf8');
		git(work, ['add', 'staging-moved.txt']);
		git(work, ['commit', '-m', 'stage: moved']);
		git(work, ['push', 'origin', 'staging']);

		expect(() => promoteCommitToBranchWithExpectedHead(work, {
			commitSha: featureHead,
			targetBranch: 'staging',
			expectedBefore: before,
		})).toThrow(/origin\/staging moved/u);
		expect(git(work, ['rev-parse', 'origin/staging'])).not.toBe(featureHead);
	});
});
