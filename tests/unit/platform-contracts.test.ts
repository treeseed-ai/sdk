import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPlatformWorkset, environmentProfileDescriptorSchema, integrationLockSchema, loadPlatformInventory, loadPlatformProfiles, planPlatformWorkset, providerSessionSchema, resolveProfileProjects, verifyPlatformRepository, type GitRunner, type Inventory, type PlatformProfile, type RemoteObserver } from '../../src/platform/index.ts';

const temporaryRoots: string[] = [];
const temporary = () => { const root = mkdtempSync(resolve(tmpdir(), 'platform-contracts-')); temporaryRoots.push(root); return root; };
afterEach(() => temporaryRoots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const inventory: Inventory = {
	schemaVersion: 'treeseed.seed-bundle/v3',
	resources: {
		projects: [
			{ key: 'project:platform', slug: 'platform', primaryRepository: 'repository:platform' },
			{ key: 'project:sdk', slug: 'sdk', primaryRepository: 'repository:sdk' },
			{ key: 'project:api', slug: 'api', primaryRepository: 'repository:api' },
		],
		repositories: [
			{ key: 'repository:platform', project: 'project:platform', role: 'primary', gitUrl: 'https://example.test/platform.git', defaultBranch: 'main' },
			{ key: 'repository:sdk', project: 'project:sdk', role: 'primary', gitUrl: 'https://example.test/sdk.git', defaultBranch: 'main', repositoryPolicy: { stagingBranch: 'staging' } },
			{ key: 'repository:api', project: 'project:api', role: 'primary', gitUrl: 'https://example.test/api.git', defaultBranch: 'main', repositoryPolicy: { stagingBranch: 'staging' } },
		],
	},
};
const commit = '1'.repeat(40);
const remote: RemoteObserver = { observe: () => commit, isAncestor: () => true };
const failingGit: GitRunner = { run: () => { throw new Error('not a checkout'); } };

describe('Platform inventory and profiles', () => {
	it('loads a seed inventory without an API', () => {
		const root = temporary();
		mkdirSync(resolve(root, 'seeds'));
		writeFileSync(resolve(root, 'treeseed.site.yaml'), 'development:\n  local:\n    inventory: { source: seed, path: seeds/inventory.yaml }\n');
		writeFileSync(resolve(root, 'seeds/inventory.yaml'), 'schemaVersion: treeseed.seed-bundle/v3\nresources:\n  projects: []\n  repositories: []\n');
		expect(loadPlatformInventory(root).inventory.resources.projects).toEqual([]);
	});

	it('unions inherited profiles and rejects cycles', () => {
		const profiles: PlatformProfile[] = [
			{ schemaVersion: 'treeseed.platform-profile/v1', id: 'core', extends: [], sources: { projects: ['sdk'] }, runtime: { targets: [] } },
			{ schemaVersion: 'treeseed.platform-profile/v1', id: 'control-plane', extends: ['core'], sources: { projects: ['api'] }, runtime: { targets: [] } },
		];
		expect(resolveProfileProjects(profiles, ['control-plane'])).toEqual(['api', 'sdk']);
		expect(() => resolveProfileProjects([{ ...profiles[0], extends: ['core'] }], ['core'])).toThrow(/cycle/u);
	});

	it('loads profiles from the conventional declarative directory', () => {
		const root = temporary();
		mkdirSync(resolve(root, 'profiles'));
		writeFileSync(resolve(root, 'profiles/core.yaml'), 'schemaVersion: treeseed.platform-profile/v1\nid: core\nsources:\n  projects: [sdk]\nruntime:\n  targets: []\n');
		expect(loadPlatformProfiles(root).map((profile) => profile.id)).toEqual(['core']);
	});
});

describe('Platform worksets', () => {
	it('defaults to all primary projects under packages and excludes Platform', () => {
		const root = temporary();
		const plan = planPlatformWorkset({ root, inventoryPath: 'seed.yaml', inventoryDigest: 'sha256:test', inventory, remote, git: failingGit });
		expect(plan.entries.map((entry) => [entry.project, entry.action, entry.path])).toEqual([
			['api', 'clone', resolve(root, 'packages/api')],
			['sdk', 'clone', resolve(root, 'packages/sdk')],
		]);
	});

	it('supports project and exclude selection', () => {
		const root = temporary();
		const plan = planPlatformWorkset({ root, inventoryPath: 'seed.yaml', inventoryDigest: 'sha256:test', inventory, selection: { projects: ['api', 'sdk'], exclude: ['api'] }, remote, git: failingGit });
		expect(plan.entries.map((entry) => entry.project)).toEqual(['sdk']);
	});

	it('rejects a moved remote before applying any checkout mutation', () => {
		const root = temporary();
		const plan = planPlatformWorkset({ root, inventoryPath: 'seed.yaml', inventoryDigest: 'sha256:test', inventory, selection: { projects: ['sdk'] }, remote, git: failingGit });
		const calls: string[][] = [];
		const git: GitRunner = { run: (_cwd, args) => { calls.push(args); return commit; } };
		const moved: RemoteObserver = { observe: () => '2'.repeat(40), isAncestor: () => true };
		expect(() => applyPlatformWorkset(plan, git, moved)).toThrow(/moved/u);
		expect(calls).toEqual([]);
	});
});

describe('Platform repository verification', () => {
	it('accepts declarations and rejects implementation and personal paths', () => {
		const root = temporary();
		execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
		writeFileSync(resolve(root, 'README.md'), '# Platform\n');
		writeFileSync(resolve(root, 'package.json'), '{}\n');
		writeFileSync(resolve(root, 'AGENTS.md'), 'Never use /home/example/work.\n');
		execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
		const result = verifyPlatformRepository(root);
		expect(result.ok).toBe(false);
		expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(['content_root_forbidden', 'personal_path_forbidden']));
	});

	it('accepts the project-scoped Skills lock and reports a missing tracked file', () => {
		const root = temporary();
		execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
		writeFileSync(resolve(root, 'README.md'), '# Platform\n');
		writeFileSync(resolve(root, 'skills-lock.json'), '{"version":1,"skills":{}}\n');
		execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
		expect(verifyPlatformRepository(root).ok).toBe(true);
		rmSync(resolve(root, 'README.md'));
		const missing = verifyPlatformRepository(root);
		expect(missing.ok).toBe(false);
		expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: 'tracked_file_missing', path: 'README.md' }));
	});

	it('does not require a production declaration in a development-only Platform', () => {
		const root = temporary();
		execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
		mkdirSync(resolve(root, 'seeds'));
		writeFileSync(resolve(root, 'treeseed.site.yaml'), 'development:\n  local:\n    inventory: { source: seed, path: seeds/inventory.yaml }\n');
		writeFileSync(resolve(root, 'seeds/inventory.yaml'), 'schemaVersion: treeseed.seed-bundle/v3\nresources: { projects: [], repositories: [] }\n');
		execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
		expect(verifyPlatformRepository(root)).toMatchObject({ ok: true, diagnostics: [] });
	});
});

describe('Platform release and provider contracts', () => {
	it('requires immutable integration components', () => {
		expect(() => integrationLockSchema.parse({ schemaVersion: 'treeseed.platform-integration-lock/v1', release: 'candidate', components: [], digest: 'latest' })).toThrow();
	});

	it('keeps environment values outside descriptors and requires bounded sessions', () => {
		expect(environmentProfileDescriptorSchema.parse({ schemaVersion: 'treeseed.provider-environment-profile/v1', id: 'model-access', variables: [{ name: 'MODEL_TOKEN', available: true }] })).not.toHaveProperty('value');
		expect(() => providerSessionSchema.parse({ schemaVersion: 'treeseed.provider-session/v1', providerId: 'provider', scope: [], issuedAt: 'now', expiresAt: 'later', token: '' })).toThrow();
	});
});
