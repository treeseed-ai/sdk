import { mkdirSync,mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe,expect,it } from 'vitest';
import { discoverRepositorySaveNodes } from '../../../../src/operations/services/repository-save-orchestrator/repositories/discover-repository-save-nodes.ts';
import { synchronizeRepositoryAliases } from '../../../../src/operations/services/repository-save-orchestrator/repositories/repository-alias-state.ts';

function git(cwd: string, args: string[]) {
	const result = spawnSync('git', args, { cwd,stdio: 'pipe',encoding: 'utf8' });
	if (result.status !== 0) throw new Error(result.stderr || result.stdout);
	return result.stdout.trim();
}

function fixtureRoot() {
	const root = mkdtempSync(resolve(tmpdir(), 'repository-alias-state-'));
	const origin = resolve(root, 'origin.git');
	const source = resolve(root, 'source');
	mkdirSync(origin, { recursive: true });
	mkdirSync(source, { recursive: true });
	git(origin, ['init', '--bare']);
	git(source, ['init', '-b', 'staging']);
	git(source, ['config', 'user.email', 'test@example.com']);
	git(source, ['config', 'user.name', 'Test User']);
	git(source, ['remote', 'add', 'origin', origin]);
	writeFileSync(resolve(source, 'README.md'), 'initial\n');
	git(source, ['add', '-A']);
	git(source, ['commit', '-m', 'initial']);
	git(source, ['push', '-u', 'origin', 'staging']);
	git(root, ['init', '-b', 'staging']);
	git(root, ['config', 'user.email', 'test@example.com']);
	git(root, ['config', 'user.name', 'Test User']);
	for (const path of ['packages/one/.fixtures/shared', 'packages/two/.fixtures/shared']) {
		mkdirSync(dirname(resolve(root, path)), { recursive: true });
		git(root, ['clone', '--branch', 'staging', origin, path]);
	}
	writeFileSync(resolve(root, '.gitmodules'), [
		'[submodule "one"]',
		'\tpath = packages/one/.fixtures/shared',
		`\turl = ${origin}`,
		'[submodule "two"]',
		'\tpath = packages/two/.fixtures/shared',
		`\turl = ${origin}`,
		'',
	].join('\n'));
	git(root, ['add', '-A']);
	git(root, ['commit', '-m', 'initial']);
	return { root,paths: ['packages/one/.fixtures/shared', 'packages/two/.fixtures/shared'] };
}

describe('repository alias state', () => {
	it('recovers a linearly newer committed alias when all materialized files are identical', () => {
		const { root,paths } = fixtureRoot();
		for (const path of paths) writeFileSync(resolve(root, path, 'README.md'), 'updated\n');
		git(resolve(root, paths[0]!), ['add', '-A']);
		git(resolve(root, paths[0]!), ['commit', '-m', 'update']);

		const nodes = discoverRepositorySaveNodes(root, root, 'staging');
		const shared = nodes.find((node) => node.checkoutAliases.length === 2);
		expect(shared?.relativePath).toBe(paths[0]);
		expect(shared?.checkoutAliases).toEqual(paths);
		git(resolve(root, paths[0]!), ['push', 'origin', 'staging']);
		expect(synchronizeRepositoryAliases(root, shared!, 'staging')).toEqual([paths[1]]);
		expect(git(resolve(root, paths[1]!), ['rev-parse', 'HEAD'])).toBe(git(resolve(root, paths[0]!), ['rev-parse', 'HEAD']));
		expect(git(resolve(root, paths[1]!), ['status', '--porcelain'])).toBe('');
	});

	it('rejects aliases whose materialized content differs', () => {
		const { root,paths } = fixtureRoot();
		writeFileSync(resolve(root, paths[0]!, 'README.md'), 'first\n');
		writeFileSync(resolve(root, paths[1]!, 'README.md'), 'second\n');
		git(resolve(root, paths[0]!), ['add', '-A']);
		git(resolve(root, paths[0]!), ['commit', '-m', 'update']);

		expect(() => discoverRepositorySaveNodes(root, root, 'staging')).toThrow(/identical worktree state/u);
	});
});
