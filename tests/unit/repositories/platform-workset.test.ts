import { existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe,expect,it } from 'vitest';
import { applyPlatformWorkset,planPlatformWorkset } from '../../../src/operations/services/repositories/platform-workset.ts';
import { discoverManagedRepositories } from '../../../src/operations/services/support/managed-repositories.ts';

function git(cwd: string, args: string[]) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(result.stderr || result.stdout);
	return result.stdout.trim();
}

function fixtureRepository(root: string, name: string) {
	const source = resolve(root, `${name}-source`);
	const remote = resolve(root, `${name}.git`);
	mkdirSync(source, { recursive: true });
	git(source, ['init', '--quiet']);
	git(source, ['config', 'user.name', 'Workset Test']);
	git(source, ['config', 'user.email', 'workset@example.test']);
	writeFileSync(resolve(source, 'README.md'), `# ${name}\n`);
	git(source, ['add', 'README.md']);
	git(source, ['commit', '--quiet', '-m', `Create ${name}`]);
	git(source, ['branch', '-M', 'main']);
	git(root, ['clone', '--quiet', '--bare', source, remote]);
	return { repository: `file://${remote}`, commit: git(source, ['rev-parse', 'HEAD']), source, remote };
}

function platformFixture() {
	const root = mkdtempSync(resolve(tmpdir(), 'trsd-platform-workset-test-'));
	const first = fixtureRepository(root, 'sdk');
	const second = fixtureRepository(root, 'template-engineering');
	const platform = resolve(root, 'platform');
	mkdirSync(platform);
	writeFileSync(resolve(platform, '.gitignore'), '.treeseed/\n/packages/\n/templates/\n/.fixtures/\n');
	writeFileSync(resolve(platform, 'treeseed.portfolio.json'), `${JSON.stringify({
		schemaVersion: 1,
		kind: 'treeseed.portfolio',
		materialization: 'ephemeral_workset',
		integrationAuthority: 'treeseed.integration-change-set/v1',
		repositories: [
			{ path: 'packages/sdk', repository: first.repository, commit: first.commit },
			{ path: 'templates/engineering', repository: second.repository, commit: second.commit },
		],
	}, null, 2)}\n`);
	git(platform, ['init', '--quiet']);
	git(platform, ['config', 'user.name', 'Workset Test']);
	git(platform, ['config', 'user.email', 'workset@example.test']);
	git(platform, ['add', '.gitignore', 'treeseed.portfolio.json']);
	git(platform, ['commit', '--quiet', '-m', 'Create Platform portfolio']);
	return { platform, first, second };
}

describe('Platform repository worksets', () => {
	it('plans, materializes, verifies, receipts, and idempotently replays exact detached repositories', () => {
		const fixture = platformFixture();
		const plan = planPlatformWorkset({ root: fixture.platform });
		expect(plan.summary).toEqual({ create: 2, noop: 0, blocked: 0 });

		const applied = applyPlatformWorkset({ root: fixture.platform });
		expect(applied.summary).toEqual({ create: 0, noop: 2, blocked: 0 });
		expect(git(resolve(fixture.platform, 'packages/sdk'), ['rev-parse', 'HEAD'])).toBe(fixture.first.commit);
		expect(git(resolve(fixture.platform, 'packages/sdk'), ['branch', '--show-current'])).toBe('');
		expect(existsSync(applied.receiptPath)).toBe(true);
		expect(JSON.parse(readFileSync(applied.receiptPath, 'utf8'))).toMatchObject({ kind: 'treeseed.platform-workset-receipt', status: 'verified' });
		expect(planPlatformWorkset({ root: fixture.platform }).summary).toEqual({ create: 0, noop: 2, blocked: 0 });
		expect(git(fixture.platform, ['status', '--porcelain'])).toBe('');
		expect(discoverManagedRepositories(fixture.platform).map(({ relativeDir, kind }) => ({ relativeDir, kind })).sort((left, right) => left.relativeDir.localeCompare(right.relativeDir))).toEqual([
			{ relativeDir: '.', kind: 'root' },
			{ relativeDir: 'packages/sdk', kind: 'package' },
			{ relativeDir: 'templates/engineering', kind: 'template' },
		]);
	});

	it('creates a requested branch and blocks dirty or divergent replays without resetting them', () => {
		const fixture = platformFixture();
		applyPlatformWorkset({ root: fixture.platform, branch: 'feature/federation' });
		const sdk = resolve(fixture.platform, 'packages/sdk');
		expect(git(sdk, ['branch', '--show-current'])).toBe('feature/federation');
		writeFileSync(resolve(sdk, 'README.md'), '# locally edited\n');
		const dirty = planPlatformWorkset({ root: fixture.platform, branch: 'feature/federation' });
		expect(dirty.summary).toEqual({ create: 0, noop: 1, blocked: 1 });
		expect(dirty.actions.find((entry) => entry.path === 'packages/sdk')?.reason).toContain('uncommitted');
	});

	it('rejects Market, content, duplicate, unsafe, and non-exact portfolio entries', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'trsd-platform-workset-invalid-'));
		const manifest = (repositories: unknown[]) => writeFileSync(resolve(root, 'treeseed.portfolio.json'), JSON.stringify({ schemaVersion: 1, kind: 'treeseed.portfolio', materialization: 'ephemeral_workset', repositories }));
		manifest([{ path: 'packages/market', repository: 'treeseed-ai/market', commit: 'a'.repeat(40) }]);
		expect(() => planPlatformWorkset({ root })).toThrow(/cannot materialize/iu);
		manifest([{ path: '../api', repository: 'treeseed-ai/api', commit: 'a'.repeat(40) }]);
		expect(() => planPlatformWorkset({ root })).toThrow(/safe relative path/iu);
		manifest([{ path: 'packages/api', repository: 'treeseed-ai/api-content', commit: 'a'.repeat(40) }]);
		expect(() => planPlatformWorkset({ root })).toThrow(/cannot materialize/iu);
		manifest([{ path: 'packages/api', repository: 'treeseed-ai/api', commit: 'main' }]);
		expect(() => planPlatformWorkset({ root })).toThrow(/exact 40-character/iu);
	});
});
