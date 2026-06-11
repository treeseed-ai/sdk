import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeseedWorkflowSdk } from '../../src/workflow.ts';
import { TreeseedWorkflowError } from '../../src/workflow/operations.ts';
import { acquireWorkflowLock, createWorkflowRunJournal, releaseWorkflowLock, updateWorkflowRunJournal } from '../../src/workflow/runs.ts';
import { runWorkspaceSavePreflight } from '../../src/operations/services/save-deploy-preflight.ts';
import { inspectDetachedHeadRepair, reattachDetachedHeadIfSafe } from '../../src/operations/services/git-workflow.ts';
import { createDevTagMessage } from '../../src/operations/services/package-reference-policy.ts';
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
		runWorkspaceReleasePreflight: vi.fn(),
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
	writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({
		name: 'workflow-demo',
		version: '1.0.0',
		lockfileVersion: 3,
		packages: {
			'': {
				name: 'workflow-demo',
				version: '1.0.0',
				workspaces: [],
			},
		},
	}, null, 2), 'utf8');
	writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: Demo
slug: demo
siteUrl: https://demo.example.com
contactEmail: demo@example.com
hosting:
  kind: treeseed_control_plane
  teamId: demo-team
  projectId: demo-project
runtime:
  mode: treeseed_managed
cloudflare:
  accountId: replace-with-cloudflare-account-id
surfaces:
  web:
    enabled: true
    provider: cloudflare
    rootDir: .
    environments:
      staging:
        domain: staging.demo.example.com
      prod:
        domain: demo.example.com
services:
  api:
    enabled: true
    provider: railway
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:api
      healthcheckPath: /healthz
  operationsRunner:
    enabled: true
    provider: railway
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api-operations-runner-01
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:runner
      healthcheckPath: /healthz
      runtimeMode: service
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 1
        maxRunners: 4
        volumeMountPath: /data
  treeseedDatabase:
    enabled: true
    provider: railway
    railway:
      resourceType: postgres
      serviceName: treeseed-api-postgres
      serviceTargets:
        - api
        - operationsRunner
providers:
  deploy: cloudflare
`, 'utf8');
	writeFileSync(resolve(root, 'README.md'), '# Demo\n', 'utf8');
}

function writeRootWorkspaceManifests(root: string, packageDirNames: string[]) {
	const rootPackage = {
		name: 'workflow-demo',
		version: '1.0.0',
		private: true,
		workspaces: packageDirNames.length > 0 ? ['packages/*'] : [],
	};
	writeFileSync(resolve(root, 'package.json'), JSON.stringify(rootPackage, null, 2), 'utf8');
	const packageEntries: Record<string, unknown> = {
		'': {
			name: rootPackage.name,
			version: rootPackage.version,
			workspaces: rootPackage.workspaces,
		},
	};
	for (const dirName of packageDirNames) {
		const packageJson = JSON.parse(readFileSync(resolve(root, 'packages', dirName, 'package.json'), 'utf8'));
		packageEntries[`packages/${dirName}`] = {
			name: packageJson.name,
			version: packageJson.version,
		};
		packageEntries[`node_modules/${packageJson.name}`] = {
			resolved: `packages/${dirName}`,
			link: true,
		};
	}
	writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({
		name: rootPackage.name,
		version: rootPackage.version,
		lockfileVersion: 3,
		packages: packageEntries,
	}, null, 2), 'utf8');
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
  RAILWAY_API_TOKEN:
    label: Railway API token
    group: auth
    description: Railway API token for status configuration tests.
    howToGet: Set any value.
    sensitivity: secret
    targets:
      - github-secret
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: conditional
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
      minLength: 8
    sourcePriority:
      - machine-config
      - process-env
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
				kind: 'treeseed_control_plane',
				teamId: 'demo-team',
				projectId: 'demo-project',
			},
			runtime: { mode: 'treeseed_managed' },
			cloudflare: { accountId: 'replace-with-cloudflare-account-id' },
			surfaces: {
				web: {
					enabled: true,
					provider: 'cloudflare',
					rootDir: '.',
					environments: {
						staging: { domain: 'staging.demo.example.com' },
						prod: { domain: 'demo.example.com' },
					},
				},
			},
			services: {
				api: {
					enabled: true,
					provider: 'railway',
					rootDir: 'packages/api',
					railway: {
						projectName: 'treeseed-api',
						serviceName: 'treeseed-api',
						rootDir: 'packages/api',
						buildCommand: 'npm run build',
						startCommand: 'npm run start:api',
						healthcheckPath: '/healthz',
					},
				},
				operationsRunner: {
					enabled: true,
					provider: 'railway',
					rootDir: 'packages/api',
					railway: {
						projectName: 'treeseed-api',
						serviceName: 'treeseed-api-operations-runner-01',
						rootDir: 'packages/api',
						buildCommand: 'npm run build',
						startCommand: 'npm run start:runner',
						healthcheckPath: '/healthz',
						runtimeMode: 'service',
						volumeMountPath: '/data',
						runnerPool: {
							bootstrapCount: 1,
							maxRunners: 4,
							volumeMountPath: '/data',
						},
					},
				},
				treeseedDatabase: {
					enabled: true,
					provider: 'railway',
					railway: {
						resourceType: 'postgres',
						serviceName: 'treeseed-api-postgres',
						serviceTargets: ['api', 'operationsRunner'],
					},
				},
			},
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
	if (dirName === 'sdk') {
		mkdirSync(resolve(root, 'dist'), { recursive: true });
		writeFileSync(resolve(root, 'dist', 'workflow-support.js'), 'export {};\n', 'utf8');
		writeFileSync(resolve(root, 'dist', 'plugin-default.js'), 'export {};\n', 'utf8');
		mkdirSync(resolve(root, 'drizzle', 'd1'), { recursive: true });
		mkdirSync(resolve(root, 'drizzle', 'market'), { recursive: true });
		writeFileSync(resolve(root, 'drizzle', 'd1', '0000_treeseed_d1.sql'), '-- d1 schema\n', 'utf8');
			writeFileSync(resolve(root, 'drizzle', 'market', '0000_market_control_plane.sql'), '-- market pg schema\n', 'utf8');
	} else if (dirName === 'core') {
		mkdirSync(resolve(root, 'dist'), { recursive: true });
		writeFileSync(resolve(root, 'dist', 'api.js'), 'export {};\n', 'utf8');
		writeFileSync(resolve(root, 'dist', 'plugin-default.js'), 'export {};\n', 'utf8');
	} else if (dirName === 'cli') {
		mkdirSync(resolve(root, 'dist', 'cli'), { recursive: true });
		writeFileSync(resolve(root, 'dist', 'cli', 'main.js'), '#!/usr/bin/env node\n', 'utf8');
	}
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
			agent: createPackageRepo(root, 'agent', { '@treeseed/sdk': '^0.4.12' }),
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
		gitAllowFile(work, ['submodule', 'add', packages.agent.origin, 'packages/agent']);
		for (const dirName of ['sdk', 'core', 'cli', 'agent']) {
			const packageRoot = resolve(work, 'packages', dirName);
			git(packageRoot, ['config', 'user.name', 'Treeseed Test']);
			git(packageRoot, ['config', 'user.email', 'treeseed@example.com']);
		}
		writeRootWorkspaceManifests(work, ['sdk', 'core', 'cli', 'agent']);
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

function createAnnotatedDevTag(repoDir: string, input: { packageName: string; version: string; branch: string }) {
	git(repoDir, ['tag', '-a', input.version, '-m', createDevTagMessage({
		packageName: input.packageName,
		version: input.version,
		branch: input.branch,
		commitSha: git(repoDir, ['rev-parse', 'HEAD']),
		createdAt: '2026-05-08T01:02:03.000Z',
	})]);
	git(repoDir, ['push', 'origin', input.version]);
}

function setPackageVersion(repoDir: string, version: string) {
	const packageJsonPath = resolve(repoDir, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	packageJson.version = version;
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
	git(repoDir, ['add', 'package.json']);
	git(repoDir, ['commit', '-m', `test: set version ${version}`]);
	git(repoDir, ['push', 'origin', 'staging']);
}

describe('treeseed workflow lifecycle', () => {
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-workflow-home-')));
		vi.stubEnv('TREESEED_STAGE_WAIT_MODE', 'skip');
		vi.stubEnv('TREESEED_COMMIT_MESSAGE_PROVIDER', 'fallback');
		vi.stubEnv('TREESEED_SAVE_NPM_INSTALL_MODE', 'skip');
		vi.stubEnv('TREESEED_GIT_DEPENDENCY_SMOKE', 'skip');
		vi.stubEnv('TREESEED_COMMAND_READINESS_MODE', 'skip');
		vi.stubEnv('TREESEED_RELEASE_CANDIDATE_REHEARSAL_MODE', 'skip');
		vi.stubEnv('TREESEED_RELEASE_CANDIDATE_CONFIG_PARITY_MODE', 'skip');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('dispatches staging deploy when deployed resource verification has no pushed save', () => {
		const source = readFileSync(new URL('../../src/workflow/operations.ts', import.meta.url), 'utf8');
		const hostedCiStart = source.indexOf("if (branch === STAGING_BRANCH) {");
		const hostedCiEnd = source.indexOf("helpers.write('[save][workflow] Waiting for hosted save workflow gates.');", hostedCiStart);
		const hostedCiSource = source.slice(hostedCiStart, hostedCiEnd);

		expect(hostedCiSource).toContain("if (effectiveInput.verifyDeployedResources !== true || scope === 'local' || !savedRootRepo.commitSha)");
		expect(hostedCiSource).toContain('dispatchGitHubWorkflowRun');
		expect(hostedCiSource).toContain("workflow: 'deploy.yml'");
		expect(hostedCiSource).toContain("environment: 'staging'");
		expect(hostedCiSource).toContain("action_kind: 'deploy_web'");
		expect(hostedCiSource).toContain('waitForWorkflowGates');
		expect(hostedCiSource).toContain("workflowGates.filter((gate) => !(gate.repository === repository && gate.workflow === 'deploy.yml'))");
	});

	it('uses deploy-gate timeouts for package-local deploy workflows', () => {
		const source = readFileSync(new URL('../../src/workflow/operations.ts', import.meta.url), 'utf8');
		const start = source.indexOf('function gatesForSavedRepositoryReports');
		const end = source.indexOf('function packageHostedVerifyWorkflow', start);
		const gateSource = source.slice(start, end);

		expect(gateSource).toContain('hostedWorkflowForSavedRepository');
		expect(gateSource).toContain('hostedDeployGate(gate)');
		expect(gateSource).toContain('/^deploy(?:[-.]|$)/u.test(workflow)');
	});

	it('defaults staging save plans to the fast lane', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		git(work, ['checkout', 'staging']);
		const workflow = workflowFor(work);

		const result = await workflow.save({
			plan: true,
			refreshPreview: false,
		});

		expect(result.payload.lane).toBe('fast');
		expect(result.payload.ciMode).toBe('off');
		expect(result.payload.releaseCandidateMode).toBe('hybrid');
		expect(result.payload.plannedSteps).not.toEqual(expect.arrayContaining([
			expect.objectContaining({ id: 'hosted-ci' }),
		]));
	}, 15000);

	it('resolves status from nested directories against the tenant root', async () => {
		const { work } = createWorkflowRepo();
		const nested = resolve(work, 'src', 'content');
		const workflow = workflowFor(nested);

		const result = await workflow.status();

		expect(result.ok).toBe(true);
		expect(result.payload.cwd).toBe(work);
		expect(result.payload.branchName).toBe('feature/demo-task');
	});

	it('reattaches a clean detached package repo at staging head', () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const sdkRoot = resolve(work, 'packages', 'sdk');
		const stagingHead = git(sdkRoot, ['rev-parse', 'staging']);
		git(sdkRoot, ['checkout', '--detach', stagingHead]);

		const report = reattachDetachedHeadIfSafe(sdkRoot, ['staging', 'main']);

		expect(report.repaired).toBe(true);
		expect(report.targetBranch).toBe('staging');
		expect(git(sdkRoot, ['branch', '--show-current'])).toBe('staging');
	}, 15_000);

	it('reattaches a dirty detached package repo at the same staging head without losing changes', () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const sdkRoot = resolve(work, 'packages', 'sdk');
		const stagingHead = git(sdkRoot, ['rev-parse', 'staging']);
		git(sdkRoot, ['checkout', '--detach', stagingHead]);
		writeFileSync(resolve(sdkRoot, 'dirty.txt'), 'preserve me\n', 'utf8');

		const report = reattachDetachedHeadIfSafe(sdkRoot, ['staging', 'main']);

		expect(report.repaired).toBe(true);
		expect(report.dirty).toBe(true);
		expect(git(sdkRoot, ['branch', '--show-current'])).toBe('staging');
		expect(readFileSync(resolve(sdkRoot, 'dirty.txt'), 'utf8')).toBe('preserve me\n');
		expect(git(sdkRoot, ['status', '--porcelain'])).toContain('dirty.txt');
	}, 15_000);

	it('leaves divergent detached package repos untouched with a clear blocker', () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const sdkRoot = resolve(work, 'packages', 'sdk');
		git(sdkRoot, ['checkout', '-b', 'release-temp']);
		writeFileSync(resolve(sdkRoot, 'temp.txt'), 'not a release branch\n', 'utf8');
		git(sdkRoot, ['add', 'temp.txt']);
		git(sdkRoot, ['commit', '-m', 'test: divergent detached head']);
		const tempHead = git(sdkRoot, ['rev-parse', 'HEAD']);
		git(sdkRoot, ['checkout', '--detach', tempHead]);

		const report = reattachDetachedHeadIfSafe(sdkRoot, ['staging', 'main']);

		expect(report.repaired).toBe(false);
		expect(report.repairable).toBe(false);
		expect(report.blocker).toContain('does not match staging or main');
		expect(git(sdkRoot, ['rev-parse', 'HEAD'])).toBe(tempHead);
		expect(git(sdkRoot, ['branch', '--show-current'])).toBe('');
	}, 15_000);

	it('treats normal package branch checkouts as a no-op', () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const sdkRoot = resolve(work, 'packages', 'sdk');

		const report = inspectDetachedHeadRepair(sdkRoot, ['staging', 'main']);

		expect(report.detached).toBe(false);
		expect(report.repairable).toBe(false);
		expect(git(sdkRoot, ['branch', '--show-current'])).toBe('staging');
	}, 15000);

	it('save repairs package repos detached at the current branch head before preflight validation', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		git(work, ['checkout', 'staging']);
		const sdkRoot = resolve(work, 'packages', 'sdk');
		const stagingHead = git(sdkRoot, ['rev-parse', 'staging']);
		git(sdkRoot, ['checkout', '--detach', stagingHead]);
		const progress: string[] = [];
		const workflow = new TreeseedWorkflowSdk({ cwd: work, write: (line) => progress.push(line) });

		const result = await workflow.save({
			message: 'chore: checkpoint after failed release',
			verify: false,
			refreshPreview: false,
		});

		expect(result.ok).toBe(true);
		expect(git(sdkRoot, ['branch', '--show-current'])).toBe('staging');
		expect(progress.join('\n')).toContain('[workflow][repair] Reattached @treeseed/sdk to staging');
	}, 360000);

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
			storage: 'shared',
		} as any, 'railway-token-from-machine-config');
		lockTreeseedSecretSession(work);
		const workflow = new TreeseedWorkflowSdk({ cwd: work, env: statusEnv, write: () => {} });

		const result = await workflow.status();

		expect(result.ok).toBe(true);
		expect(result.payload.auth.railway).toBe(false);
		expect(result.payload.providerStatus.staging.railway.configured).toBe(false);
		expect(result.payload.providerStatus.local.railway.configured).toBe(true);
		expect(result.payload.providerStatus.local.railway.applicable).toBe(false);
		expect(result.payload.secrets.keyAgentUnlocked).toBe(true);
		expect(result.payload.persistentEnvironments.staging.blockers.join('\n')).not.toContain('STATUS_REQUIRED_TOKEN');
	}, 360000);

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
	}, 180000);

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
			'@treeseed/agent',
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
	}, 180000);

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
			lane: 'promotion',
		});

		expect(result.ok).toBe(true);
		const sdkReport = result.payload.repos.find((repo) => repo.name === '@treeseed/sdk');
		expect(sdkReport?.branch).toBe('staging');
		expect(sdkReport?.branchMode).toBe('package-dev-save');
		expect(sdkReport?.tagName).toMatch(/^0\.4\.13-dev\.staging\./);
		expect(result.payload.lane).toBe('promotion');
		expect(result.payload.ciMode).toBe('hosted');
		expect(result.payload.workflowGates).toEqual(expect.arrayContaining([
			expect.objectContaining({ name: result.payload.rootRepo.name, workflow: 'deploy.yml', branch: 'staging', timeoutSeconds: 2700 }),
			expect.objectContaining({ name: '@treeseed/sdk', workflow: 'verify.yml', branch: 'staging' }),
		]));
		expect(result.payload.workflowGates).not.toEqual(expect.arrayContaining([
			expect.objectContaining({ name: result.payload.rootRepo.name, workflow: 'verify.yml', branch: 'staging' }),
		]));
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', '0.4.13'])).toBe('');
	}, 180000);

	it('plans a fresh dev version when a clean package HEAD is ahead of its dev tag', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		git(work, ['checkout', 'staging']);
		const sdkRoot = resolve(work, 'packages', 'sdk');
		git(sdkRoot, ['checkout', 'staging']);
		writeFileSync(resolve(sdkRoot, 'index.js'), 'export const name = "sdk-tagged";\n', 'utf8');
		const workflow = workflowFor(work);
		const first = await workflow.save({
			verify: false,
			refreshPreview: false,
		});
		expect(first.ok).toBe(true);
		const firstSdkReport = first.payload.repos.find((repo) => repo.name === '@treeseed/sdk');
		expect(firstSdkReport?.tagName).toMatch(/^0\.4\.13-dev\.staging\./);
		const oldTag = String(firstSdkReport?.tagName);
		const oldTagCommit = git(sdkRoot, ['rev-list', '-n', '1', oldTag]);

		writeFileSync(resolve(sdkRoot, 'README.md'), '# sdk\nstandalone ci fix\n', 'utf8');
		git(sdkRoot, ['add', 'README.md']);
		git(sdkRoot, ['commit', '-m', 'fix: standalone ci']);
		git(sdkRoot, ['push', 'origin', 'staging']);
		expect(JSON.parse(readFileSync(resolve(sdkRoot, 'package.json'), 'utf8')).version).toBe(oldTag);

		const second = await workflow.save({
			verify: false,
			refreshPreview: false,
		});

		expect(second.ok).toBe(true);
		const secondSdkReport = second.payload.repos.find((repo) => repo.name === '@treeseed/sdk');
		expect(secondSdkReport?.committed).toBe(true);
		expect(secondSdkReport?.tagName).toMatch(/^0\.4\.13-dev\.staging\./);
		expect(secondSdkReport?.tagName).not.toBe(oldTag);
		expect(git(sdkRoot, ['rev-list', '-n', '1', oldTag])).toBe(oldTagCommit);
		expect(git(sdkRoot, ['rev-list', '-n', '1', String(secondSdkReport?.tagName)])).toBe(secondSdkReport?.commitSha);
	}, 300000);

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
	}, 180000);

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
	}, 180000);

	it('creates managed worktrees for agent switch without moving the primary checkout', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = new TreeseedWorkflowSdk({
			cwd: work,
			env: { ...process.env, CODEX_AGENT_ID: 'agent-1', GIT_ALLOW_PROTOCOL: 'file' },
			write: () => {},
		});

		const result = await workflow.switchTask({
			branch: 'feature/agent-worktree',
		});

		expect(String(result.payload.worktreePath)).toContain('.treeseed/worktrees/');
		expect(git(work, ['branch', '--show-current'])).toBe('feature/demo-task');
		expect(git(String(result.payload.worktreePath), ['branch', '--show-current'])).toBe('feature/agent-worktree');
		expect(existsSync(resolve(String(result.payload.worktreePath), 'node_modules/.bin/trsd'))).toBe(true);
		expect(existsSync(resolve(String(result.payload.worktreePath), 'node_modules/.bin/treeseed'))).toBe(true);
	}, 180000);

	it('removes managed worktrees after agent close cleanup', async () => {
		const { work } = createWorkflowRepo();
		const env = { ...process.env, CODEX_AGENT_ID: 'agent-1' };
		const workflow = new TreeseedWorkflowSdk({ cwd: work, env, write: () => {} });
		const switched = await workflow.switchTask({
			branch: 'feature/agent-close',
		});
		const worktreePath = String(switched.payload.worktreePath);
		const managedWorkflow = new TreeseedWorkflowSdk({ cwd: worktreePath, env, write: () => {} });

		const closed = await managedWorkflow.close({
			message: 'close agent branch',
			deletePreview: false,
		});

		expect(closed.payload.worktreeCleanup.removed).toBe(true);
		expect(existsSync(worktreePath)).toBe(false);
		expect(git(work, ['branch', '--show-current'])).toBe('feature/demo-task');
	}, 180000);

	it('stages from a managed worktree and removes it after promotion', async () => {
		const { work } = createWorkflowRepo();
		git(work, ['checkout', 'staging']);
		const env = { ...process.env, CODEX_AGENT_ID: 'agent-1' };
		const workflow = new TreeseedWorkflowSdk({ cwd: work, env, write: () => {} });
		const switched = await workflow.switchTask({
			branch: 'feature/agent-stage',
		});
		const worktreePath = String(switched.payload.worktreePath);
		writeFileSync(resolve(worktreePath, 'agent-stage.txt'), 'managed stage\n', 'utf8');
		const managedWorkflow = new TreeseedWorkflowSdk({ cwd: worktreePath, env, write: () => {} });

		const staged = await managedWorkflow.stage({
			message: 'stage managed worktree',
			deletePreview: false,
		});

		expect(staged.payload.worktreeCleanup.removed).toBe(true);
		expect(existsSync(worktreePath)).toBe(false);
		 git(work, ['fetch', 'origin', 'staging']);
		expect(git(work, ['show', 'origin/staging:agent-stage.txt'])).toBe('managed stage');
		expect(git(work, ['branch', '--show-current'])).toBe('staging');
	}, 180000);

	it('fails switch when a checked-out package repo is dirty', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-dirty";\n', 'utf8');
		const workflow = workflowFor(work);

		await expect(workflow.switchTask({ branch: 'feature/blocked-task' })).rejects.toThrow(
			'clean git worktree',
		);
	}, 180000);

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
	}, 180000);

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
	}, 180000);

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
	}, 180000);

	it('does not auto-resume a failed save when the workspace has new edits', async () => {
		const { work, packages } = createWorkflowRepo({ withWorkspacePackages: true });
		git(work, ['checkout', 'staging']);
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-dirty-save";\n', 'utf8');
		git(resolve(work, 'packages', 'core'), ['remote', 'remove', 'origin']);
		const workflow = workflowFor(work);

		await expect(workflow.save({
			message: 'feat: original dirty save',
			verify: false,
			ciMode: 'off',
			refreshPreview: false,
		})).rejects.toBeInstanceOf(TreeseedWorkflowError);

		const recoverResult = await workflow.recover();
		const runId = recoverResult.payload.interruptedRuns[0]?.runId;
		expect(runId).toMatch(/^save-/);

		git(resolve(work, 'packages', 'core'), ['remote', 'add', 'origin', packages!.core.origin]);
		writeFileSync(resolve(work, 'README.md'), '# Demo\n\nnew repair edits\n', 'utf8');

		const freshResult = await workflow.save({
			message: 'fix: save repair edits',
			verify: false,
			ciMode: 'off',
			refreshPreview: false,
		});
		expect(freshResult.runId).not.toBe(runId);
		expect(freshResult.payload.autoResumed).toBe(false);
		expect(freshResult.payload.message).toBe('fix: save repair edits');
	}, 180000);

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
	}, 180000);

	it('classifies stale release runs and prunes them from resumable recovery', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		const currentHead = git(work, ['rev-parse', 'HEAD']);
		createWorkflowRunJournal(work, {
			runId: 'release-stale-test',
			command: 'release',
			input: { bump: 'patch' },
			session: {
				root: work,
				mode: 'recursive-workspace',
				branchName: 'staging',
				repos: [
					{ name: '@treeseed/market', path: work, branchName: 'staging' },
					{ name: '@treeseed/sdk', path: resolve(work, 'packages/sdk'), branchName: 'staging' },
				],
			},
			steps: [
				{ id: 'release-plan', description: 'Record release plan', repoName: '@treeseed/market', repoPath: work, branch: 'staging', resumable: true },
				{ id: 'release-root', description: 'Release market repo', repoName: '@treeseed/market', repoPath: work, branch: 'staging', resumable: true },
			],
		});
		updateWorkflowRunJournal(work, 'release-stale-test', (journal) => ({
			...journal,
			status: 'failed',
			failure: { code: 'unsupported_state', message: 'old release failed', details: null, at: new Date().toISOString() },
			steps: journal.steps.map((step) => step.id === 'release-plan'
				? {
					...step,
					status: 'completed',
					completedAt: new Date().toISOString(),
					data: {
						rootRepo: { name: '@treeseed/market', commitSha: 'old-root-head' },
						repos: [{ name: '@treeseed/sdk', commitSha: git(resolve(work, 'packages/sdk'), ['rev-parse', 'HEAD']) }],
						packageSelection: { selected: ['@treeseed/sdk'] },
					},
				}
				: step),
		}));
		expect(currentHead).not.toBe('old-root-head');

		const recover = await workflow.recover();
		expect(recover.payload.interruptedRuns.map((run: { runId: string }) => run.runId)).not.toContain('release-stale-test');
		expect(recover.payload.staleRuns.map((run: { runId: string }) => run.runId)).toContain('release-stale-test');

		const pruned = await workflow.recover({ pruneStale: true });
		expect(pruned.payload.prunedRuns.map((run: { runId: string }) => run.runId)).toContain('release-stale-test');

		const finalRecover = await workflow.recover();
		expect(finalRecover.payload.staleRuns.map((run: { runId: string }) => run.runId)).not.toContain('release-stale-test');

		createWorkflowRunJournal(work, {
			runId: 'release-obsolete-test',
			command: 'release',
			input: { bump: 'patch' },
			session: {
				root: work,
				mode: 'recursive-workspace',
				branchName: 'staging',
				repos: [{ name: '@treeseed/market', path: work, branchName: 'staging' }],
			},
			steps: [
				{ id: 'release-plan', description: 'Record release plan', repoName: '@treeseed/market', repoPath: work, branch: 'staging', resumable: true },
			],
		});
		updateWorkflowRunJournal(work, 'release-obsolete-test', (journal) => ({
			...journal,
			status: 'failed',
			failure: { code: 'unsupported_state', message: 'operator obsolete test', details: null, at: new Date().toISOString() },
		}));

		const obsolete = await workflow.recover({ obsoleteRunId: 'release-obsolete-test', obsoleteReason: 'superseded by test' });

		expect(obsolete.payload.markedObsoleteRun).toMatchObject({ runId: 'release-obsolete-test', reason: 'superseded by test' });
		expect(obsolete.payload.interruptedRuns.map((run: { runId: string }) => run.runId)).not.toContain('release-obsolete-test');
	}, 180000);

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
		vi.mocked(runWorkspaceSavePreflight).mockImplementationOnce(({ cwd }) => {
			expect(existsSync(resolve(cwd, 'node_modules', '@treeseed', 'core', 'package.json'))).toBe(true);
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
	}, 180000);

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
	}, 180000);

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
		createAnnotatedDevTag(resolve(work, 'packages', 'sdk'), {
			packageName: '@treeseed/sdk',
			version: '0.4.12-dev.staging.20260501T010203Z',
			branch: 'staging',
		});
		createAnnotatedDevTag(resolve(work, 'packages', 'sdk'), {
			packageName: '@treeseed/sdk',
			version: '0.4.12-dev.feature-demo.20260501T010204Z',
			branch: 'feature/demo',
		});

		const result = await workflow.release({ bump: 'patch', ciMode: 'off' });

		expect(result.payload.mode).toBe('recursive-workspace');
		expect(result.payload.packageSelection.changed).toContain('@treeseed/sdk');
		expect(result.payload.packageSelection.changed).toEqual(expect.arrayContaining(['@treeseed/core', '@treeseed/cli']));
		expect(result.payload.touchedPackages).toEqual(expect.arrayContaining(['@treeseed/sdk', '@treeseed/core', '@treeseed/cli']));
		expect(JSON.parse(git(resolve(work, 'packages', 'sdk'), ['show', 'main:package.json'])).version).toBe('0.4.13');
		expect(JSON.parse(git(resolve(work, 'packages', 'core'), ['show', 'main:package.json'])).version).toBe('0.4.13');
		expect(JSON.parse(git(resolve(work, 'packages', 'cli'), ['show', 'main:package.json'])).version).toBe('0.4.12');
		expect(JSON.parse(git(resolve(work, 'packages', 'core'), ['show', 'main:package.json'])).dependencies['@treeseed/sdk']).toBe(`git+file://${packages!.sdk.origin}#0.4.13`);
		expect(JSON.parse(git(resolve(work, 'packages', 'cli'), ['show', 'main:package.json'])).dependencies['@treeseed/sdk']).toBe(`git+file://${packages!.sdk.origin}#0.4.13`);
		expect(JSON.parse(git(work, ['show', 'main:package.json'])).dependencies['@treeseed/sdk']).toBe(`git+file://${packages!.sdk.origin}#0.4.13`);
		expect(git(work, ['ls-tree', 'main', 'packages/sdk'])).toContain(git(resolve(work, 'packages', 'sdk'), ['rev-parse', 'main']));
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', '0.4.12-dev.*'])).toBe('');
		expect(git(resolve(work, 'packages', 'sdk'), ['ls-remote', '--tags', 'origin', '0.4.12-dev.*'])).toBe('');
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', '0.4.13-dev.*'])).toContain('0.4.13-dev.');
		expect(result.payload.devTagCleanup.candidateCount).toBeGreaterThanOrEqual(2);
		expect(result.payload.devTagCleanup.cleanedCount).toBeGreaterThanOrEqual(2);
		expect(result.payload.publishWait.every((entry) => entry.status === 'skipped')).toBe(true);
		expect(result.payload.repos.every((repo: { workflowGates: Array<{ workflow: string }> }) =>
			repo.workflowGates.every((gate) => gate.workflow === 'publish.yml'))).toBe(true);
			expect(result.payload.workflowGates.filter((gate: { name: string }) => gate.name === '@treeseed/market')).toEqual([
				expect.objectContaining({
					workflow: 'deploy.yml',
					branch: 'staging',
				}),
				expect.objectContaining({
					workflow: 'deploy.yml',
					branch: result.payload.rootVersion,
					timeoutSeconds: 2700,
				}),
		]);
		expect(git(work, ['show', 'main:CHANGELOG.md'])).toContain(`## [${result.payload.rootVersion}]`);
		expect(git(resolve(work, 'packages', 'sdk'), ['show', 'main:CHANGELOG.md'])).toContain('## [0.4.13]');
		expect(git(resolve(work, 'packages', 'sdk'), ['log', '-1', '--format=%B', 'main'])).toContain('Release summary:');
		expect(git(work, ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'sdk'), ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'core'), ['branch', '--show-current'])).toBe('staging');
		expect(git(resolve(work, 'packages', 'cli'), ['branch', '--show-current'])).toBe('staging');
	}, 300000);

	it('keeps stale dev tags when release dev tag cleanup is disabled', async () => {
		const { work, packages } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		await workflow.switchTask({ branch: 'feature/demo-task' });
		writeFileSync(resolve(work, 'packages', 'sdk', 'index.js'), 'export const name = "sdk-release-no-cleanup";\n', 'utf8');
		await workflow.save({
			message: 'feat: release without cleanup',
			verify: false,
			refreshPreview: false,
		});
		await workflow.stage({
			message: 'stage: release without cleanup',
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
		createAnnotatedDevTag(resolve(work, 'packages', 'sdk'), {
			packageName: '@treeseed/sdk',
			version: '0.4.12-dev.staging.20260501T010203Z',
			branch: 'staging',
		});

		const result = await workflow.release({ bump: 'patch', ciMode: 'off', devTagCleanup: 'off' });

		expect(result.payload.devTagCleanup).toMatchObject({ status: 'skipped', reason: 'disabled' });
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', '0.4.12-dev.staging.20260501T010203Z'])).toBe('0.4.12-dev.staging.20260501T010203Z');
		expect(git(resolve(work, 'packages', 'sdk'), ['ls-remote', '--tags', 'origin', '0.4.12-dev.staging.20260501T010203Z'])).toContain('0.4.12-dev.staging.20260501T010203Z');
	}, 300000);

	it('plans and executes standalone stale dev tag cleanup', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		const sdkDir = resolve(work, 'packages', 'sdk');
		createAnnotatedDevTag(sdkDir, {
			packageName: '@treeseed/sdk',
			version: '0.4.11-dev.staging.20260501T010203Z',
			branch: 'staging',
		});
		createAnnotatedDevTag(sdkDir, {
			packageName: '@treeseed/sdk',
			version: '0.4.11-dev.feature-demo.20260501T010204Z',
			branch: 'feature/demo',
		});
		createAnnotatedDevTag(sdkDir, {
			packageName: '@treeseed/sdk',
			version: '0.4.12-dev.staging.20260501T010205Z',
			branch: 'staging',
		});

		const plan = await workflow.tagsCleanup({
			plan: true,
			includePackages: '@treeseed/sdk',
		});

		expect(plan.executionMode).toBe('plan');
		expect(plan.payload.candidateCount).toBe(2);
		expect(plan.payload.cleanedCount).toBe(0);
		expect(git(sdkDir, ['tag', '--list', '0.4.11-dev.*'])).toContain('0.4.11-dev.');

		const result = await workflow.tagsCleanup({
			includePackages: ['@treeseed/sdk'],
		});

		expect(result.payload.candidateCount).toBe(2);
		expect(result.payload.cleanedCount).toBe(2);
		expect(git(sdkDir, ['tag', '--list', '0.4.11-dev.*'])).toBe('');
		expect(git(sdkDir, ['ls-remote', '--tags', 'origin', '0.4.11-dev.*'])).toBe('');
		expect(git(sdkDir, ['tag', '--list', '0.4.12-dev.staging.20260501T010205Z'])).toBe('0.4.12-dev.staging.20260501T010205Z');
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

		vi.stubEnv('GH_TOKEN', '');
		vi.stubEnv('GITHUB_TOKEN', '');
		await expect(workflow.release({ bump: 'patch' })).rejects.toThrow('authenticated managed GitHub CLI');
		const recoverResult = await workflow.recover();
		const runId = recoverResult.payload.interruptedRuns[0]?.runId;
		expect(runId).toMatch(/^release-/);

		const autoResumeResult = await workflow.release({ bump: 'minor', ciMode: 'off' });

		expect(autoResumeResult.runId).toBe(runId);
		expect(autoResumeResult.payload.resumed).toBe(true);
		expect(autoResumeResult.payload.resumedRunId).toBe(runId);
		expect(autoResumeResult.payload.autoResumed).toBe(true);
		expect(autoResumeResult.payload.level).toBe('patch');
		expect(autoResumeResult.payload.rootVersion).toBe('1.0.1');
		expect(JSON.parse(git(resolve(work, 'packages', 'sdk'), ['show', 'main:package.json'])).version).toBe('0.4.13');
	}, 300000);

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
			'@treeseed/agent': '0.4.13',
		});
		expect(result.payload.plannedDevReferenceRewrites.some((entry: { repoName: string }) => entry.repoName === '@treeseed/market')).toBe(true);
		expect(result.payload.plannedPublishWaits).toHaveLength(4);
		expect(result.payload.plannedSteps.map((step: { id: string }) => step.id)).toEqual(expect.arrayContaining(['release-plan', 'prepare-release-metadata', 'cleanup-dev-tags']));
		expect(git(work, ['rev-parse', 'HEAD'])).toBe(beforeRootHead);
		expect(git(resolve(work, 'packages', 'sdk'), ['rev-parse', 'HEAD'])).toBe(beforeSdkHead);
		expect(git(resolve(work, 'packages', 'sdk'), ['tag', '--list', '0.4.13'])).toBe('');
	}, 300000);

	it('plans release-line repair without bumping packages already on the target line', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		git(work, ['checkout', 'staging']);
		setPackageVersion(resolve(work, 'packages', 'sdk'), '0.10.6');
		setPackageVersion(resolve(work, 'packages', 'core'), '0.9.4');
		setPackageVersion(resolve(work, 'packages', 'cli'), '0.9.3');
		setPackageVersion(resolve(work, 'packages', 'agent'), '0.9.3');
		git(work, ['add', 'packages/sdk', 'packages/core', 'packages/cli', 'packages/agent']);
		git(work, ['commit', '-m', 'test: drift public package lines']);
		git(work, ['push', 'origin', 'staging']);

		const result = await workflow.release({
			bump: 'patch',
			repairVersionLine: true,
			targetVersionLine: '0.10',
			plan: true,
		});

		expect(result.executionMode).toBe('plan');
		expect(result.payload.releaseLine).toMatchObject({
			repair: true,
			targetLine: '0.10',
			highestCurrentLine: '0.10',
			alignedBefore: false,
		});
		expect(result.payload.packageSelection.selected).toEqual([
			'@treeseed/core',
			'@treeseed/cli',
			'@treeseed/agent',
		]);
		expect(result.payload.plannedVersions).toMatchObject({
			'@treeseed/market': '1.0.1',
			'@treeseed/core': '0.10.0',
			'@treeseed/cli': '0.10.0',
			'@treeseed/agent': '0.10.0',
		});
		expect(result.payload.plannedVersions).not.toHaveProperty('@treeseed/sdk');
		expect(result.payload.blockers).toEqual([]);
	}, 180000);

	it('blocks normal patch releases when public package release lines are drifted', async () => {
		const { work } = createWorkflowRepo({ withWorkspacePackages: true });
		const workflow = workflowFor(work);
		git(work, ['checkout', 'staging']);
		setPackageVersion(resolve(work, 'packages', 'sdk'), '0.10.6');
		setPackageVersion(resolve(work, 'packages', 'core'), '0.9.4');
		setPackageVersion(resolve(work, 'packages', 'cli'), '0.9.3');
		setPackageVersion(resolve(work, 'packages', 'agent'), '0.9.3');
		git(work, ['add', 'packages/sdk', 'packages/core', 'packages/cli', 'packages/agent']);
		git(work, ['commit', '-m', 'test: drift public package lines']);
		git(work, ['push', 'origin', 'staging']);

		const plan = await workflow.release({ bump: 'patch', plan: true });

		expect(plan.payload.blockers.join('\n')).toContain('Public package version line drift detected');
		await expect(workflow.release({ bump: 'patch', ciMode: 'off' })).rejects.toThrow('Public package version line drift detected');
		await expect(workflow.release({
			bump: 'patch',
			repairVersionLine: true,
			targetVersionLine: '0.11',
			plan: true,
		})).rejects.toThrow('Release line repair target must match the highest current public package line');
	}, 180000);

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
	}, 180000);
});
