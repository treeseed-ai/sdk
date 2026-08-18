import { existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe,expect,it } from 'vitest';
import { applyPlatformWorkset,planPlatformWorkset,verifiedPlatformWorksetReceipt } from '../../../src/operations/services/repositories/platform-workset.ts';
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
	git(platform, ['init', '--quiet']);
	git(platform, ['config', 'user.name', 'Workset Test']);
	git(platform, ['config', 'user.email', 'workset@example.test']);
	git(platform, ['add', '.gitignore']);
	git(platform, ['commit', '--quiet', '-m', 'Create Platform workspace']);
	const inventory = [
		{ projectId: 'project-sdk', role: 'primary', path: 'packages/sdk', repository: first.repository, branch: 'main' },
		{ projectId: 'project-template-engineering', role: 'primary', path: 'templates/engineering', repository: second.repository, branch: 'main' },
	];
	return { platform, first, second, inventory };
}

describe('Platform repository worksets', () => {
	it('plans, materializes, verifies, receipts, and idempotently replays exact detached repositories', () => {
		const fixture = platformFixture();
		const input = { root: fixture.platform, teamId: 'team-a', inventory: fixture.inventory };
		const plan = planPlatformWorkset(input);
		expect(plan.summary).toEqual({ create: 2, noop: 0, blocked: 0 });

		const applied = applyPlatformWorkset(input);
		expect(applied.summary).toEqual({ create: 0, noop: 2, blocked: 0 });
		expect(git(resolve(fixture.platform, 'packages/sdk'), ['rev-parse', 'HEAD'])).toBe(fixture.first.commit);
		expect(git(resolve(fixture.platform, 'packages/sdk'), ['branch', '--show-current'])).toBe('');
		expect(existsSync(applied.receiptPath)).toBe(true);
		expect(JSON.parse(readFileSync(applied.receiptPath, 'utf8'))).toMatchObject({ kind: 'treeseed.platform-workset-receipt', status: 'verified', teamId: 'team-a', inventoryDigest: expect.any(String) });
		expect(planPlatformWorkset(input).summary).toEqual({ create: 0, noop: 2, blocked: 0 });
		expect(git(fixture.platform, ['status', '--porcelain'])).toBe('');
		expect(discoverManagedRepositories(fixture.platform).map(({ relativeDir, kind }) => ({ relativeDir, kind })).sort((left, right) => left.relativeDir.localeCompare(right.relativeDir))).toEqual([
			{ relativeDir: '.', kind: 'root' },
			{ relativeDir: 'packages/sdk', kind: 'package' },
			{ relativeDir: 'templates/engineering', kind: 'template' },
		]);
		const receipt = JSON.parse(readFileSync(applied.receiptPath, 'utf8'));
		receipt.completed[0].commit = '0'.repeat(40);
		writeFileSync(applied.receiptPath, `${JSON.stringify(receipt)}\n`, 'utf8');
		expect(verifiedPlatformWorksetReceipt(fixture.platform)).toBeNull();
		expect(discoverManagedRepositories(fixture.platform).map((entry) => entry.relativeDir)).toEqual(['.']);
	});

	it('creates a requested branch and blocks dirty or divergent replays without resetting them', () => {
		const fixture = platformFixture();
		const input = { root: fixture.platform, teamId: 'team-a', inventory: fixture.inventory, branch: 'feature/federation', authority: {
			schemaVersion: 1 as const, kind: 'treeseed.governed-workset-authority' as const, status: 'active' as const,
			teamId: 'team-a', projectId: 'project-sdk', decisionId: 'decision-a', capacityPlanId: 'plan-a', workDayId: 'workday-a',
			assignmentId: 'assignment-a', mode: 'acting' as const, baseCommit: fixture.first.commit, expiresAt: new Date(Date.now() + 60_000).toISOString(),
		} };
		applyPlatformWorkset(input);
		const sdk = resolve(fixture.platform, 'packages/sdk');
		expect(git(sdk, ['branch', '--show-current'])).toBe('feature/federation');
		writeFileSync(resolve(sdk, 'README.md'), '# locally edited\n');
		const dirty = planPlatformWorkset(input);
		expect(dirty.summary).toEqual({ create: 0, noop: 1, blocked: 1 });
		expect(dirty.actions.find((entry) => entry.path === 'packages/sdk')?.reason).toContain('uncommitted');
		expect(dirty.actions.find((entry) => entry.path === 'packages/sdk')?.custody).toBe('assignment-write');
		expect(dirty.actions.find((entry) => entry.path === 'templates/engineering')?.custody).toBe('read-only');
	});

	it('rejects writable custody without an acting assignment authority', () => {
		const fixture = platformFixture();
		expect(() => planPlatformWorkset({ root: fixture.platform, teamId: 'team-a', inventory: fixture.inventory, branch: 'feature/unsafe' }))
			.toThrow(/acting-assignment authority/iu);
	});

	it('rejects Market, content, duplicate, unsafe, and unresolved team inventory entries', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'trsd-platform-workset-invalid-'));
		const entry = (path: string, repository: string, branch = 'main') => ({ projectId: 'project-a', role: 'primary', path, repository, branch });
		expect(() => planPlatformWorkset({ root, teamId: 'team-a', inventory: [entry('packages/market', 'treeseed-ai/market')] })).toThrow(/cannot materialize/iu);
		expect(() => planPlatformWorkset({ root, teamId: 'team-a', inventory: [entry('../api', 'treeseed-ai/api')] })).toThrow(/safe relative path/iu);
		expect(() => planPlatformWorkset({ root, teamId: 'team-a', inventory: [entry('packages/api', 'treeseed-ai/api-content')] })).toThrow(/cannot materialize/iu);
		expect(() => planPlatformWorkset({ root, teamId: 'team-a', inventory: [entry('packages/api', 'file:///missing/repository.git')] })).toThrow(/could not be resolved/iu);
	});
});
