import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pushCurrentBranch } from '../../../../src/operations/services/repository-save-orchestrator/support/run-script.ts';
import type { RepositorySaveNode, RepositorySaveOptions } from '../../../../src/operations/services/repository-save-orchestrator/support/repo-kind.ts';
import { run } from '../../../../src/operations/services/treedx/workspaces/workspace-tools.ts';

const roots: string[] = [];

function testTempBase() {
	const base = join(process.cwd(), '.treeseed', 'test-tmp');
	mkdirSync(base, { recursive: true });
	return base;
}

function node(path: string, remoteUrl: string): RepositorySaveNode {
	return {
		id: path,
		name: 'shared-fixture',
		path,
		relativePath: path,
		kind: 'fixture',
		branch: 'feature/editorial',
		branchMode: 'package-dev-save',
		packageJsonPath: null,
		packageJson: null,
		scripts: {},
		manifestVerifyCommands: { fast: null, local: null, release: null },
		remoteUrl,
		dependencies: [],
		dependents: [],
		submoduleDependencies: [],
		plannedVersion: null,
		plannedTag: null,
		plannedDependencySpec: null,
	};
}

function options(root: string): RepositorySaveOptions {
	return {
		root,
		gitRoot: root,
		branch: 'feature/editorial',
		verifyMode: 'skip',
		gitRemoteWriteMode: 'off',
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('deferred repository push containment', () => {
	it('accepts an older verified checkout after another checkout published its descendant', () => {
		const root = mkdtempSync(join(testTempBase(), 'treeseed-shared-remote-'));
		roots.push(root);
		const remote = join(root, 'remote.git');
		const older = join(root, 'older');
		const newer = join(root, 'newer');
		run('git', ['init', '--bare', remote], { cwd: root });
		run('git', ['init', older], { cwd: root });
		run('git', ['config', 'user.name', 'Treeseed Test'], { cwd: older });
		run('git', ['config', 'user.email', 'test@treeseed.local'], { cwd: older });
		writeFileSync(join(older, 'README.md'), 'older\n', 'utf8');
		run('git', ['add', 'README.md'], { cwd: older });
		run('git', ['commit', '-m', 'older'], { cwd: older });
		run('git', ['branch', '-M', 'feature/editorial'], { cwd: older });
		run('git', ['remote', 'add', 'origin', remote], { cwd: older });

		pushCurrentBranch(node(older, remote), options(root), 'feature/editorial');
		run('git', ['clone', '--branch', 'feature/editorial', remote, newer], { cwd: root });
		run('git', ['config', 'user.name', 'Treeseed Test'], { cwd: newer });
		run('git', ['config', 'user.email', 'test@treeseed.local'], { cwd: newer });
		writeFileSync(join(newer, 'README.md'), 'newer\n', 'utf8');
		run('git', ['commit', '-am', 'newer'], { cwd: newer });
		pushCurrentBranch(node(newer, remote), options(root), 'feature/editorial');
		const newerHead = run('git', ['rev-parse', 'HEAD'], { cwd: newer, capture: true }).trim();

		const repeated = pushCurrentBranch(node(older, remote), options(root), 'feature/editorial');
		const remoteHead = run('git', ['ls-remote', remote, 'refs/heads/feature/editorial'], { cwd: root, capture: true }).trim().split(/\s+/u)[0];

		expect(repeated).toMatchObject({ pushed: true, branchAlreadyPublished: true, remoteHead: newerHead });
		expect(remoteHead).toBe(newerHead);
	});
});
