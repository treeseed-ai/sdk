import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeseedWorkflowSdk } from '../../src/workflow.ts';
import { TreeseedWorkflowError } from '../../src/workflow/operations.ts';
import { acquireWorkflowLock, releaseWorkflowLock } from '../../src/workflow/runs.ts';
import {
	createDefaultTreeseedMachineConfig,
	ensureTreeseedSecretSessionForConfig,
	lockTreeseedSecretSession,
	setTreeseedMachineEnvironmentValue,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	writeTreeseedMachineConfig,
} from '../../src/operations/services/config-runtime.ts';

vi.mock('../../src/operations/services/save-deploy-preflight.ts', async () => {
	const actual = await vi.importActual<typeof import('../../src/operations/services/save-deploy-preflight.ts')>('../../src/operations/services/save-deploy-preflight.ts');
	return {
		...actual,
		runWorkspaceSavePreflight: vi.fn(),
		runTenantDeployPreflight: vi.fn(),
	};
});

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
	const result = spawnSync('git', args, {
		cwd,
		env: { ...process.env, ...env },
		stdio: 'pipe',
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`);
	}
	return result.stdout.trim();
}

function gitAllowFile(cwd: string, args: string[]) {
	return git(cwd, ['-c', 'protocol.file.allow=always', ...args]);
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
hosting:
  kind: hosted_project
  teamId: demo-team
  projectId: demo-project
cloudflare:
  accountId: replace-with-cloudflare-account-id
providers:
  deploy: cloudflare
`, 'utf8');
	writeFileSync(resolve(root, 'README.md'), '# Demo\n', 'utf8');
}

function writeStatusConfigEntry(root: string) {
	writeFileSync(resolve(root, 'src', 'env.yaml'), `entries:
  STATUS_REQUIRED_TOKEN:
    label: Status required token
    group: auth
    description: Required only for status configuration tests.
    howToGet: Set any value.
    sensitivity: secret
    targets:
      - local-runtime
    scopes:
      - staging
    storage: scoped
    requirement: required
    purposes:
      - config
    validation:
      kind: nonempty
`, 'utf8');
}

function createMachineConfigForWorkflowRepo(root: string) {
	return createDefaultTreeseedMachineConfig({
		tenantRoot: root,
		deployConfig: {
			name: 'Demo',
			slug: 'demo',
			siteUrl: 'https://demo.example.com',
			contactEmail: 'demo@example.com',
			hosting: {
				kind: 'hosted_project',
				teamId: 'demo-team',
				projectId: 'demo-project',
			},
			cloudflare: { accountId: 'replace-with-cloudflare-account-id' },
			providers: { deploy: 'cloudflare' },
		} as any,
		tenantConfig: { id: 'demo' } as any,
	});
}

function writePackageFiles(root: string, dirName: string, dependencies: Record<string, string> = {}) {
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({
		name: `@treeseed/${dirName}`,
		version: dirName === 'cli' ? '0.4.11' : '0.4.12',
		type: 'module',
		scripts: {
			'verify:action': 'node -e "process.exit(0)"',
			'verify:local': 'node -e "process.exit(0)"',
			'release:publish': 'node -e "process.exit(0)"',
		},
		dependencies,
	}, null, 2), 'utf8');
	writeFileSync(resolve(root, 'README.md'), `# ${dirName}\n`, 'utf8');
	writeFileSync(resolve(root, 'index.js'), `export const name = '${dirName}';\n`, 'utf8');
	mkdirSync(resolve(root, '.github', 'workflows'), { recursive: true });
	writeFileSync(resolve(root, '.github', 'workflows', 'publish.yml'), 'name: Publish\non:\n  push:\n    branches: [main]\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo publish\n', 'utf8');
}

function createPackageRepo(root: string, dirName: string, dependencies: Record<string, string> = {}) {
	const origin = resolve(root, `${dirName}.git`);
	const work = resolve(root, `${dirName}-work`);
	mkdirSync(work, { recursive: true });
	git(root, ['init', '--bare', origin]);
	git(work, ['init', '-b', 'staging']);
	git(work, ['config', 'user.name', 'Treeseed Test']);
	git(work, ['config', 'user.email', 'treeseed@example.com']);
	writePackageFiles(work, dirName, dependencies);
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', `init: ${dirName}`]);
	git(work, ['remote', 'add', 'origin', origin]);
	git(work, ['push', '-u', 'origin', 'staging']);
	git(work, ['checkout', '-b', 'main']);
	git(work, ['push', '-u', 'origin', 'main']);
	git(work, ['checkout', 'staging']);
	git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/staging']);
	return { origin, work };
}

function createWorkflowRepo(options: { withWorkspacePackages?: boolean } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-workflow-lifecycle-'));
	const origin = resolve(root, 'origin.git');
	const work = resolve(root, 'work');
	const packages = options.withWorkspacePackages
		? {
			sdk: createPackageRepo(root, 'sdk'),
			core: createPackageRepo(root, 'core', { '@treeseed/sdk': '^0.4.12' }),
			cli: createPackageRepo(root, 'cli', { '@treeseed/sdk': '^0.4.12' }),
		}
		: null;
	mkdirSync(work, { recursive: true });
	git(root, ['init', '--bare', origin]);
	git(work, ['init', '-b', 'staging']);
	git(work, ['config', 'user.name', 'Treeseed Test']);
	git(work, ['config', 'user.email', 'treeseed@example.com']);
	writeTenantFiles(work);
	if (packages) {
		gitAllowFile(work, ['submodule', 'add', packages.sdk.origin, 'packages/sdk']);
		gitAllowFile(work, ['submodule', 'add', packages.core.origin, 'packages/core']);
		gitAllowFile(work, ['submodule', 'add', packages.cli.origin, 'packages/cli']);
		for (const dirName of ['sdk', 'core', 'cli']) {
			const packageRoot = resolve(work, 'packages', dirName);
			git(packageRoot, ['config', 'user.name', 'Treeseed Test']);
			git(packageRoot, ['config', 'user.email', 'treeseed@example.com']);
		}
	}
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
	return { work, packages };
}

function workflowFor(cwd: string) {
	return new TreeseedWorkflowSdk({ cwd, write: () => {} });
}

describe('treeseed workflow lifecycle', () => {
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-workflow-home-')));
		vi.stubEnv('TREESEED_GITHUB_AUTOMATION_MODE', 'stub');
		vi.stubEnv('TREESEED_STAGE_WAIT_MODE', 'skip');
		vi.stubEnv('TREESEED_COMMIT_MESSAGE_PROVIDER', 'fallback');
		vi.stubEnv('TREESEED_SAVE_NPM_INSTALL_MODE', 'skip');
		vi.stubEnv('TREESEED_GIT_DEPENDENCY_SMOKE', 'skip');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('resolves status from nested directories against the tenant root', async () => {
		const { work } = createWorkflowRepo();
		const nested = resolve(work, 'src', 'content');
		const workflow = workflowFor(nested);

		const result = await workflow.status();

		expect(result.ok).toBe(true);
		expect(result.payload.cwd).toBe(work);
		expect(result.payload.branchName).toBe('feature/demo-task');
	});

	it('loads existing machine config secrets before evaluating status readiness', async () => {
		const { work } = createWorkflowRepo();
		writeStatusConfigEntry(work);
		writeTreeseedMachineConfig(work, createMachineConfigForWorkflowRepo(work));
		const statusEnv = {
			...process.env,
			[TREESEED_MACHINE_KEY_PASSPHRASE_ENV]: 'status-passphrase',
		};
		await ensureTreeseedSecretSessionForConfig({
			tenantRoot: work,
			interactive: false,
			env: statusEnv,
			createIfMissing: true,
			allowMigration: true,
		});
		setTreeseedMachineEnvironmentValue(work, 'staging', {
			id: 'STATUS_REQUIRED_TOKEN',
			sensitivity: 'secret',
			storage: 'scoped',
		} as any, 'from-machine-config');
		setTreeseedMachineEnvironmentValue(work, 'staging', {
			id: 'RAILWAY_API_TOKEN',
			sensitivity: 'secret',
			storage: 'scoped',
		} as any, 'railway-token-from-machine-config');
		lockTreeseedSecretSession(work);
		const workflow = new TreeseedWorkflowSdk({ cwd: work, env: statusEnv, write: () => {} });

		const result = await workflow.status();

		expect(result.ok).toBe(true);
		expect(result.payload.auth.railway).toBe(true);
		expect(result.payload.providerStatus.staging.railway.configured).toBe(true);
		expect(result.payload.providerStatus.local.railway.configured).toBe(true);
		expect(result.payload.providerStatus.local.railway.applicable).toBe(false);
		expect(result.payload.secrets.keyAgentUnlocked).toBe(true);
		expect(result.payload.persistentEnvironments.staging.blockers.join('\n')).not.toContain('STATUS_REQUIRED_TOKEN');
	}, 180000);

	it('treats save with no new changes as a successful sync checkpoint', async () => {
		const { work } = createWorkflowRepo();
		const workflow = workflowFor(work);

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
		const workflow = workflowFor(work);

		const result = await workflow.close({
			message: 'superseded by another task',
		});

		expect(result.ok).toBe(true);
		expect(result.payload.autoSaved).toBe(true);
		expect(result.payload.finalBranch).toBe('staging');
		expect(result.payload.finalState.branchName).toBe('staging');
		expect(git(work, ['tag', '--list', 'deprecated/*'])).toContain('deprecated/feature-demo-task/');
	}, 180000);

	it('recursively saves dirty checked-out workspace packages before saving the market repo', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-updated";\n', 'utf8');
		writeFileSync(resolve(work, 'packages', 'core', 'index.js'), 'export const name = "core-updated";\n', 'utf8');
		writeFileSync(resolve(work, 'feature.txt'), 'demo\nupdated\n', 'utf8');
		const workflow = workflowFor(work);

		const result = await workflow.save({
			message: 'feat: recursive save',
			verify: false,
			refreshPreview: false,
		});

		expect(result.ok).toBe(true);
		expect(result.payload.mode).toBe('recursive-workspace');
		expect(result.payload.repos.map((repo) => repo.name)).toEqual([
			'@treeseed/sdk',
			'@treeseed/core',
			'@treeseed/cli',
		]);
		expect(result.payload.repos[0].committed).toBe(true);
		expect(result.payload.repos[0].pushed).toBe(true);
		expect(result.payload.repos[1].committed).toBe(true);
		expect(result.payload.repos[2].committed).toBe(true);
		expect(result.payload.repos[0].tagName).toMatch(/^0\.4\.13-dev\.feature-demo-task\./);
		expect(result.payload.repos[2].tagName).toMatch(/^0\.4\.12-dev\.feature-demo-task\./);
		expect(result.payload.rootRepo.committed).toBe(true);
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('feature/demo-task');
		expect(git(resolve(work, 'packages', 'core'), ['branch', '--show-current'])).toBe('feature/demo-task');
		expect(git(work, ['ls-tree', 'HEAD', 'packages/sdk'])).toContain(result.payload.repos[0].commitSha);
		expect(git(work, ['ls-tree', 'HEAD', 'packages/core'])).toContain(result.payload.repos[1].commitSha);
		const sdkVersion = JSON.parse(readFileSync(resolve(work, 'packages', 'sdk', 'package.json'), 'utf8')).version;
		const coreSdkSpec = JSON.parse(readFileSync(resolve(work, 'packages', 'core', 'package.json'), 'utf8')).dependencies['@treeseed/sdk'];
		expect(sdkVersion).toMatch(/^0\.4\.13-dev\.feature-demo-task\./);
		expect(coreSdkSpec).toMatch(/^git\+file:\/\/.*sdk\.git#0\.4\.13-dev\.feature-demo-task\./);
	}, 90000);

	it('uses dev-save mode for staging even when package repos start on main', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		git(work, ['checkout', 'staging']);
		for (const dirName of ['sdk', 'core', 'cli']) {
			git(resolve(work, 'packages', dirName), ['checkout', 'main']);
		}
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-staging";\n', 'utf8');
		const workflow = workflowFor(work);

		const result = await workflow.save({
			verify: false,
			refreshPreview: false,
		});

		expect(result.ok).toBe(true);
		const sdkReport = result.payload.repos.find((repo) => repo.name === '@treeseed/sdk');
		expect(sdkReport?.branch).toBe('staging');
		expect(sdkReport?.branchMode).toBe('package-dev-save');
		expect(sdkReport?.tagName).toMatch(/^0\.4\.13-dev\.staging\./);
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', '0.4.13'])).toBe('');
	}, 90000);

	it('switch mirrors task branches into checked-out package repos without pushing package branches', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);

		const result = await workflow.switchTask({
			branch: 'feature/parallel-task',
		});

		expect(result.payload.mode).toBe('recursive-workspace');
		expect(git(work, ['branch', '--show-current'])).toBe('feature/parallel-task');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('feature/parallel-task');
		expect(git(resolve(work, 'packages', 'core'), ['branch', '--show-current'])).toBe('feature/parallel-task');
		expect(git(work, ['ls-remote', '--heads', 'origin', 'feature/parallel-task'])).toContain('feature/parallel-task');
		expect(git(resolve(work, 'packages', 'sdk'), ['ls-remote', '--heads', 'origin', 'feature/parallel-task'])).toBe('');
		expect(git(resolve(work, 'packages', 'core'), ['ls-remote', '--heads', 'origin', 'feature/parallel-task'])).toBe('');
	}, 90000);

	it('returns switch plans without mutating the market or package repos', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);

		const result = await workflow.switchTask({
			branch: 'feature/plan-only',
			plan: true,
		});

		expect(result.executionMode).toBe('plan');
		expect(result.payload.mode).toBe('recursive-workspace');
		expect(git(work, ['branch', '--show-current'])).toBe('feature/demo-task');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('staging');
		expect(git(work, ['ls-remote', '--heads', 'origin', 'feature/plan-only'])).toBe('');
		expect(git(resolve(work, 'packages', 'sdk'), ['ls-remote', '--heads', 'origin', 'feature/plan-only'])).toBe('');
	}, 90000);

	it('fails switch when a checked-out package repo is dirty', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-dirty";\n', 'utf8');
		const workflow = workflowFor(work);

		await expect(workflow.switchTask({ branch: 'feature/blocked-task' })).rejects.toThrow(
			'clean git worktree',
		);
	}, 90000);

	it('reports partial recursive save state when a later package repo cannot be pushed', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-updated";\n', 'utf8');
		writeFileSync(resolve(work, 'packages', 'core', 'index.js'), 'export const name = "core-updated";\n', 'utf8');
		git(resolve(work, 'packages', 'core'), ['remote', 'remove', 'origin']);
		const workflow = workflowFor(work);

		try {
			await workflow.save({
				message: 'feat: recursive save',
				verify: false,
				refreshPreview: false,
			});
		} catch (error) {
			expect(error).toBeInstanceOf(TreeseedWorkflowError);
			const workflowError = error as TreeseedWorkflowError;
			const details = (
				(workflowError.details?.partialFailure as {
					repos: Array<{ name: string; pushed: boolean }>;
					failingRepo: string;
				} | undefined)
				?? (workflowError.details?.details as {
					partialFailure?: {
						repos: Array<{ name: string; pushed: boolean }>;
						failingRepo: string;
					};
				} | undefined)?.partialFailure
			) as {
				repos: Array<{ name: string; pushed: boolean }>;
				failingRepo: string;
			};
			expect(details.failingRepo).toBe('@treeseed/core');
			expect(details.repos.find((repo) => repo.name === '@treeseed/sdk')?.pushed).toBe(true);
			expect(details.repos.find((repo) => repo.name === '@treeseed/core')?.pushed).toBe(false);
		}
	}, 90000);

	it('lists interrupted workflow runs and resumes them after the workspace is repaired', async () => {
		const { work, packages } = createWorkflowRepo({ withWorkspacePackages: true });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-updated";\n', 'utf8');
		writeFileSync(resolve(work, 'packages', 'core', 'index.js'), 'export const name = "core-updated";\n', 'utf8');
		git(resolve(work, 'packages', 'core'), ['remote', 'remove', 'origin']);
		const workflow = workflowFor(work);

		await expect(workflow.save({
			message: 'feat: recursive save',
			verify: false,
			refreshPreview: false,
		})).rejects.toBeInstanceOf(TreeseedWorkflowError);

		const recoverResult = await workflow.recover();
		const runId = recoverResult.payload.interruptedRuns[0]?.runId;
		expect(recoverResult.payload.interruptedRuns.length).toBe(1);
		expect(runId).toMatch(/^save-/);

		git(resolve(work, 'packages', 'core'), ['remote', 'add', 'origin', packages!.core.origin]);

		const resumeResult = await workflow.resume({ runId });
		expect(resumeResult.runId).toBe(runId);
		expect(resumeResult.payload.repos.find((repo: { name: string }) => repo.name === '@treeseed/sdk')?.commitSha).toBeTruthy();
		expect(resumeResult.payload.repos.find((repo: { name: string }) => repo.name === '@treeseed/core')?.pushed).toBe(true);
		expect(resumeResult.payload.rootRepo.pushed).toBe(true);

		const finalRecover = await workflow.recover();
		expect(finalRecover.payload.interruptedRuns.length).toBe(0);
	}, 90000);

	it('auto-resumes the newest failed same-branch save with the original input', async () => {
		const { work, packages } = createWorkflowRepo({ withWorkspacePackages: true });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-auto-resume";\n', 'utf8');
		writeFileSync(resolve(work, 'packages', 'core', 'index.js'), 'export const name = "core-auto-resume";\n', 'utf8');
		git(resolve(work, 'packages', 'core'), ['remote', 'remove', 'origin']);
		const workflow = workflowFor(work);

		await expect(workflow.save({
			message: 'feat: original save',
			verify: false,
			refreshPreview: false,
		})).rejects.toBeInstanceOf(TreeseedWorkflowError);

		const recoverResult = await workflow.recover();
		const runId = recoverResult.payload.interruptedRuns[0]?.runId;
		expect(runId).toMatch(/^save-/);

		git(resolve(work, 'packages', 'core'), ['remote', 'add', 'origin', packages!.core.origin]);

		const autoResumeResult = await workflow.save({
			message: 'feat: new hint should not win',
			verify: false,
			refreshPreview: false,
		});
		expect(autoResumeResult.runId).toBe(runId);
		expect(autoResumeResult.payload.resumed).toBe(true);
		expect(autoResumeResult.payload.resumedRunId).toBe(runId);
		expect(autoResumeResult.payload.autoResumed).toBe(true);
		expect(autoResumeResult.payload.message).toBe('feat: original save');
		expect(autoResumeResult.payload.repos.find((repo: { name: string }) => repo.name === '@treeseed/core')?.pushed).toBe(true);
		expect(autoResumeResult.payload.rootRepo.pushed).toBe(true);
	}, 90000);

	it('surfaces active workflow locks through recover and blocks concurrent mutating commands', async () => {
		const { work } = createWorkflowRepo();
		const workflow = workflowFor(work);
		const lock = acquireWorkflowLock(work, 'save', 'save-lock-test');
		expect(lock.acquired).toBe(true);

		try {
			const recoverResult = await workflow.recover();
			expect(recoverResult.payload.lock.active).toBe(true);
			expect(recoverResult.payload.lock.lock?.runId).toBe('save-lock-test');
			await expect(workflow.switchTask({ branch: 'feature/blocked-lock' })).rejects.toMatchObject({
				code: 'workflow_locked',
			});
		} finally {
			releaseWorkflowLock(work, 'save-lock-test');
		}
	}, 90000);

	it('stages package feature branches first and points market staging at package staging heads', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-staged";\n', 'utf8');
		writeFileSync(resolve(work, 'feature.txt'), 'demo\nstage\n', 'utf8');
		await workflow.save({
			message: 'feat: prepare stage',
			verify: false,
			refreshPreview: false,
		});

		const result = await workflow.stage({
			message: 'stage: finish demo task',
			waitForStaging: false,
		});

		expect(result.payload.mode).toBe('recursive-workspace');
		expect(result.payload.mergeStrategy).toBe('squash');
		expect(git(work, ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('staging');
		expect(git(work, ['log', '-1', '--format=%s'])).toBe('stage: finish demo task');
		expect(git(resolve(work, 'packages', 'sdk'), ['log', '-1', '--format=%s'])).toBe('stage: finish demo task');
		expect(git(work, ['ls-tree', 'HEAD', 'packages/sdk'])).toContain(git(resolve(work, 'packages', 'sdk'), ['rev-parse', 'HEAD']));
		expect(JSON.parse(git(resolve(work, 'packages', 'core'), ['show', 'staging:package.json'])).dependencies['@treeseed/sdk']).toMatch(/^git\+file:\/\/.*sdk\.git#0\.4\.13-dev\.feature-demo-task\./);
		expect(git(work, ['branch', '--list', 'feature/demo-task'])).toBe('');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--list', 'feature/demo-task'])).toBe('');
	}, 90000);

	it('closes matching package task branches and preserves deprecated tags', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });

		const result = await workflow.close({
			message: 'obsolete workstream',
		});

		expect(result.payload.mode).toBe('recursive-workspace');
		expect(git(work, ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('staging');
		expect(git(work, ['branch', '--list', 'feature/demo-task'])).toBe('');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--list', 'feature/demo-task'])).toBe('');
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', 'deprecated/*'])).toContain('deprecated/feature-demo-task/');
	}, 90000);

	it('releases only changed packages plus dependents and syncs market main to package main heads', async () => {
		const { work, packages } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-release";\n', 'utf8');
		writeFileSync(resolve(work, 'feature.txt'), 'demo\nrelease\n', 'utf8');
		await workflow.save({
			message: 'feat: release sdk change',
			verify: false,
			refreshPreview: false,
		});
		await workflow.stage({
			message: 'stage: release sdk change',
			waitForStaging: false,
		});
		const rootPackageJsonPath = resolve(work, 'package.json');
		const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8'));
		const sdkDevVersion = JSON.parse(readFileSync(resolve(work, 'packages', 'sdk', 'package.json'), 'utf8')).version;
		rootPackageJson.dependencies = {
			...(rootPackageJson.dependencies ?? {}),
			'@treeseed/sdk': `git+file://${packages!.sdk.origin}#${sdkDevVersion}`,
		};
		writeFileSync(rootPackageJsonPath, `${JSON.stringify(rootPackageJson, null, 2)}\n`, 'utf8');
		git(work, ['add', 'package.json']);
		git(work, ['commit', '-m', 'stage: root package dependency']);
		git(work, ['push', 'origin', 'staging']);

		const result = await workflow.release({ bump: 'patch' });

		expect(result.payload.mode).toBe('recursive-workspace');
		expect(result.payload.packageSelection.changed).toContain('@treeseed/sdk');
		expect(result.payload.packageSelection.changed).toEqual(expect.arrayContaining(['@treeseed/core', '@treeseed/cli']));
		expect(result.payload.touchedPackages).toEqual(expect.arrayContaining(['@treeseed/sdk', '@treeseed/core', '@treeseed/cli']));
		expect(JSON.parse(git(resolve(work, 'packages', 'sdk'), ['show', 'main:package.json'])).version).toBe('0.4.13');
		expect(JSON.parse(git(resolve(work, 'packages', 'core'), ['show', 'main:package.json'])).version).toBe('0.4.13');
		expect(JSON.parse(git(resolve(work, 'packages', 'cli'), ['show', 'main:package.json'])).version).toBe('0.4.12');
		expect(JSON.parse(git(resolve(work, 'packages', 'core'), ['show', 'main:package.json'])).dependencies['@treeseed/sdk']).toBe('0.4.13');
		expect(JSON.parse(git(resolve(work, 'packages', 'cli'), ['show', 'main:package.json'])).dependencies['@treeseed/sdk']).toBe('0.4.13');
		expect(JSON.parse(git(work, ['show', 'main:package.json'])).dependencies['@treeseed/sdk']).toBe('0.4.13');
		expect(git(work, ['ls-tree', 'main', 'packages/sdk'])).toContain(git(resolve(work, 'packages', 'sdk'), ['rev-parse', 'main']));
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', '*-dev.*'])).toBe('');
		expect(git(resolve(work, 'packages', 'core'), ['tag', '--list', '*-dev.*'])).toBe('');
		expect(git(resolve(work, 'packages', 'cli'), ['tag', '--list', '*-dev.*'])).toBe('');
		expect(result.payload.publishWait.every((entry) => entry.status === 'skipped')).toBe(true);
		expect(git(work, ['branch', '--show-current'])).toBe('staging');
	}, 180000);

	it('auto-resumes the newest failed same-staging-state release with the original input', async () => {
		const { work, packages } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-release-auto-resume";\n', 'utf8');
		writeFileSync(resolve(work, 'feature.txt'), 'demo\nrelease auto resume\n', 'utf8');
		await workflow.save({
			message: 'feat: release auto resume sdk change',
			verify: false,
			refreshPreview: false,
		});
		await workflow.stage({
			message: 'stage: release auto resume sdk change',
			waitForStaging: false,
		});
		const rootPackageJsonPath = resolve(work, 'package.json');
		const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8'));
		const sdkDevVersion = JSON.parse(readFileSync(resolve(work, 'packages', 'sdk', 'package.json'), 'utf8')).version;
		rootPackageJson.dependencies = {
			...(rootPackageJson.dependencies ?? {}),
			'@treeseed/sdk': `git+file://${packages!.sdk.origin}#${sdkDevVersion}`,
		};
		writeFileSync(rootPackageJsonPath, `${JSON.stringify(rootPackageJson, null, 2)}\n`, 'utf8');
		git(work, ['add', 'package.json']);
		git(work, ['commit', '-m', 'stage: root package dependency']);
		git(work, ['push', 'origin', 'staging']);

		vi.stubEnv('TREESEED_GITHUB_AUTOMATION_MODE', 'live');
		vi.stubEnv('GH_TOKEN', '');
		vi.stubEnv('GITHUB_TOKEN', '');
		await expect(workflow.release({ bump: 'patch' })).rejects.toThrow('Configure GH_TOKEN');
		const recoverResult = await workflow.recover();
		const runId = recoverResult.payload.interruptedRuns[0]?.runId;
		expect(runId).toMatch(/^release-/);

		vi.stubEnv('TREESEED_GITHUB_AUTOMATION_MODE', 'stub');
		const autoResumeResult = await workflow.release({ bump: 'minor' });

		expect(autoResumeResult.runId).toBe(runId);
		expect(autoResumeResult.payload.resumed).toBe(true);
		expect(autoResumeResult.payload.resumedRunId).toBe(runId);
		expect(autoResumeResult.payload.autoResumed).toBe(true);
		expect(autoResumeResult.payload.level).toBe('patch');
		expect(autoResumeResult.payload.rootVersion).toBe('1.0.1');
		expect(JSON.parse(git(resolve(work, 'packages', 'sdk'), ['show', 'main:package.json'])).version).toBe('0.4.13');
	}, 90000);

	it('returns a recursive release plan without mutating package or market state', async () => {
		const { work, packages } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-release-plan";\n', 'utf8');
		writeFileSync(resolve(work, 'feature.txt'), 'demo\nrelease plan\n', 'utf8');
		await workflow.save({
			message: 'feat: release plan sdk change',
			verify: false,
			refreshPreview: false,
		});
		await workflow.stage({
			message: 'stage: release plan sdk change',
			waitForStaging: false,
		});
		const rootPackageJsonPath = resolve(work, 'package.json');
		const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8'));
		const sdkDevVersion = JSON.parse(readFileSync(resolve(work, 'packages', 'sdk', 'package.json'), 'utf8')).version;
		rootPackageJson.dependencies = {
			...(rootPackageJson.dependencies ?? {}),
			'@treeseed/sdk': `git+file://${packages!.sdk.origin}#${sdkDevVersion}`,
		};
		writeFileSync(rootPackageJsonPath, `${JSON.stringify(rootPackageJson, null, 2)}\n`, 'utf8');
		git(work, ['add', 'package.json']);
		git(work, ['commit', '-m', 'stage: root package dependency']);
		const beforeRootHead = git(work, ['rev-parse', 'HEAD']);
		const beforeSdkHead = git(resolve(work, 'packages', 'sdk'), ['rev-parse', 'HEAD']);

		const result = await workflow.release({ bump: 'patch', plan: true });

		expect(result.executionMode).toBe('plan');
		expect(result.payload.rootVersion).toBe('1.0.1');
		expect(result.payload.releaseTag).toBe('1.0.1');
		expect(result.payload.packageSelection.selected).toEqual(expect.arrayContaining(['@treeseed/sdk', '@treeseed/core', '@treeseed/cli']));
		expect(result.payload.plannedVersions).toMatchObject({
			'@treeseed/market': '1.0.1',
			'@treeseed/sdk': '0.4.13',
			'@treeseed/core': '0.4.13',
			'@treeseed/cli': '0.4.12',
		});
		expect(result.payload.plannedDevReferenceRewrites.some((entry: { repoName: string }) => entry.repoName === '@treeseed/market')).toBe(true);
		expect(result.payload.plannedPublishWaits).toHaveLength(3);
		expect(result.payload.plannedSteps.map((step: { id: string }) => step.id)).toEqual(expect.arrayContaining(['release-plan', 'prepare-release-metadata', 'cleanup-dev-tags']));
		expect(git(work, ['rev-parse', 'HEAD'])).toBe(beforeRootHead);
		expect(git(resolve(work, 'packages', 'sdk'), ['rev-parse', 'HEAD'])).toBe(beforeSdkHead);
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', '0.4.13'])).toBe('');
	}, 90000);

	it('surfaces package branch drift and dirty package blockers in status', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });
		git(resolve(work, 'packages', 'core'), ['checkout', 'staging']);
		writeFileSync(resolve(work, 'packages', 'cli', 'index.js'), 'export const name = "cli-dirty";\n', 'utf8');

		const result = await workflow.status();

		expect(result.payload.packageSync.mode).toBe('recursive-workspace');
		expect(result.payload.packageSync.aligned).toBe(false);
		expect(result.payload.packageSync.dirty).toBe(true);
		expect(result.payload.packageSync.blockers.join('\n')).toContain('@treeseed/core is on staging instead of feature/demo-task.');
		expect(result.payload.packageSync.blockers.join('\n')).toContain('@treeseed/cli has uncommitted changes.');
	}, 90000);
});
