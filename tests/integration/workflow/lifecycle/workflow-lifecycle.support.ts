import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowSdk } from '../../../../src/operations/workflow.ts';
import {
	normalizeReleaseCandidateMode,
	normalizeSaveCiMode,
	normalizeSaveLane,
	shouldUseHostedSaveCi,
	WorkflowError,
} from '../../../../src/workflow/operations.ts';
import { resolveWorkflowPaths } from '../../../../src/workflow/policy.ts';
import { acquireWorkflowLock, createWorkflowRunJournal, releaseWorkflowLock, updateWorkflowRunJournal } from '../../../../src/workflow/runs.ts';
import { runWorkspaceSavePreflight } from '../../../../src/operations/services/hosting/deployment/save-deploy-preflight.ts';
import { inspectDetachedHeadRepair, mergeBranchIntoTarget, reattachDetachedHeadIfSafe } from '../../../../src/operations/services/operations/git-workflow.ts';
import {
	createDefaultMachineConfig,
	ensureSecretSessionForConfig,
	loadMachineConfig,
	lockSecretSession,
	setMachineEnvironmentValue,
	MACHINE_KEY_PASSPHRASE_ENV,
	writeMachineConfig,
} from '../../../../src/operations/services/configuration/config-runtime.ts';
export function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
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
export function gitAllowFile(cwd: string, args: string[]) {
	return git(cwd, ['-c', 'protocol.file.allow=always', ...args]);
}
export function writePassingStageCandidate(root: string) {
	const excludePath = resolve(root, '.git', 'info', 'exclude');
	const exclude = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
	if (!exclude.includes('.treeseed/')) writeFileSync(excludePath, `${exclude}${exclude.endsWith('\n') ? '' : '\n'}.treeseed/\n`);
	const candidateDir = resolve(root, '.treeseed', 'workflow', 'stage-candidates');
	mkdirSync(candidateDir, { recursive: true });
	const manifestPath = resolve(candidateDir, 'latest.json');
	const manifest = existsSync(manifestPath)
		? JSON.parse(readFileSync(manifestPath, 'utf8'))
		: {
			schemaVersion: 2,
			kind: 'treeseed.stage-candidate',
			candidateId: `test-${git(root, ['rev-parse', 'HEAD'])}`,
			root: { repo: '@treeseed/market', commit: git(root, ['rev-parse', 'HEAD']), verified: true },
			packages: [],
		};
	manifest.root.commit = git(root, ['rev-parse', 'HEAD']);
	manifest.candidateId = `test-${manifest.root.commit}`;
	for (const pkg of manifest.packages ?? []) {
		if (typeof pkg.path === 'string' && existsSync(pkg.path)) pkg.commit = git(pkg.path, ['rev-parse', 'HEAD']);
	}
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
export function writeTenantFiles(root: string) {
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
      serviceName: treeseed-ops-01
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
export function writeRootWorkspaceManifests(root: string, packageDirNames: string[]) {
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
export function writeStatusConfigEntry(root: string) {
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
  TREESEED_RAILWAY_API_TOKEN:
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
export function createMachineConfigForWorkflowRepo(root: string) {
	return createDefaultMachineConfig({
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
						serviceName: 'treeseed-ops-01',
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
export function writePackageFiles(root: string, dirName: string, dependencies: Record<string, string> = {}) {
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({
		name: `@treeseed/${dirName}`,
		version: dirName === 'cli' ? '0.4.11' : '0.4.12',
		type: 'module',
		repository: {
			type: 'git',
			url: `git+ssh://git@github.com/treeseed-ai/${dirName}.git`,
		},
		scripts: {
			verify: 'node -e "process.exit(0)"',
			'verify:action': 'node -e "process.exit(0)"',
			'verify:local': 'node -e "process.exit(0)"',
			'release:verify': 'node -e "process.exit(0)"',
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
	} else if (dirName === 'ui') {
		mkdirSync(resolve(root, 'dist'), { recursive: true });
		writeFileSync(resolve(root, 'dist', 'index.js'), 'export {};\n', 'utf8');
	} else if (dirName === 'admin') {
		mkdirSync(resolve(root, 'dist'), { recursive: true });
		writeFileSync(resolve(root, 'dist', 'plugin.js'), 'export {};\n', 'utf8');
		writeFileSync(resolve(root, 'treeseed.package.yaml'), `id: "@treeseed/admin"
name: TreeSeed Admin
kind: node-typescript
repository: treeseed-ai/admin
publishTarget: npm
verify:
  fast: npm run verify
  local: npm run verify:local
  release: npm run release:verify
artifacts:
  - provider: npm
    name: "@treeseed/admin"
releaseGate:
  workflow: deploy.yml
`, 'utf8');
	} else if (dirName === 'cli') {
		mkdirSync(resolve(root, 'dist', 'cli'), { recursive: true });
		writeFileSync(resolve(root, 'dist', 'cli', 'main.js'), '#!/usr/bin/env node\n', 'utf8');
	}
	mkdirSync(resolve(root, '.github', 'workflows'), { recursive: true });
	writeFileSync(resolve(root, '.github', 'workflows', 'publish.yml'), 'name: Publish\non:\n  push:\n    branches: [main]\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo publish\n', 'utf8');
}
export function createPackageRepo(root: string, dirName: string, dependencies: Record<string, string> = {}) {
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
export function addStaleNestedSubmodule(parentRepo: string, relativePath: string, branch: string) {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-nested-workflow-repo-'));
	const origin = resolve(root, 'origin.git');
	const work = resolve(root, 'work');
	mkdirSync(work, { recursive: true });
	git(root, ['init', '--bare', origin]);
	git(work, ['init', '-b', 'staging']);
	git(work, ['config', 'user.name', 'Treeseed Test']);
	git(work, ['config', 'user.email', 'treeseed@example.com']);
	writeFileSync(resolve(work, 'README.md'), 'nested helper\n', 'utf8');
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', 'init: nested helper']);
	git(work, ['remote', 'add', 'origin', origin]);
	git(work, ['push', '-u', 'origin', 'staging']);
	if (branch !== 'staging') {
		git(work, ['checkout', '-b', branch]);
	}
	writeFileSync(resolve(work, 'feature.txt'), 'local helper head\n', 'utf8');
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', 'feat: helper branch']);
	git(work, ['push', '-u', 'origin', branch]);
	gitAllowFile(parentRepo, ['submodule', 'add', '-b', branch, origin, relativePath]);
	const nestedRepo = resolve(parentRepo, relativePath);
	git(nestedRepo, ['config', 'user.name', 'Treeseed Test']);
	git(nestedRepo, ['config', 'user.email', 'treeseed@example.com']);
	writeFileSync(resolve(work, 'feature.txt'), 'remote helper head\n', 'utf8');
	git(work, ['add', '-A']);
	git(work, ['commit', '-m', 'feat: advance remote helper']);
	git(work, ['push', 'origin', branch]);
	return nestedRepo;
}
export function createWorkflowRepo(options: { withWorkspacePackages?: boolean } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-workflow-lifecycle-'));
	const origin = resolve(root, 'origin.git');
	const work = resolve(root, 'work');
	let packages: Record<string, ReturnType<typeof createPackageRepo>> | null = null;
	if (options.withWorkspacePackages) {
		const sdk = createPackageRepo(root, 'sdk');
		const ui = createPackageRepo(root, 'ui');
		const gitRef = (repo: ReturnType<typeof createPackageRepo>) => `git+file://${repo.origin}#staging`;
		const core = createPackageRepo(root, 'core', { '@treeseed/sdk': gitRef(sdk) });
		packages = {
			sdk,
			ui,
			core,
			admin: createPackageRepo(root, 'admin', {
				'@treeseed/sdk': gitRef(sdk),
				'@treeseed/core': gitRef(core),
				'@treeseed/ui': gitRef(ui),
			}),
			cli: createPackageRepo(root, 'cli', { '@treeseed/sdk': gitRef(sdk) }),
			agent: createPackageRepo(root, 'agent', { '@treeseed/sdk': gitRef(sdk) }),
			api: createPackageRepo(root, 'api', { '@treeseed/sdk': gitRef(sdk) }),
			treedx: createPackageRepo(root, 'treedx'),
		};
	}
	mkdirSync(work, { recursive: true });
	git(root, ['init', '--bare', origin]);
	git(work, ['init', '-b', 'staging']);
	git(work, ['config', 'user.name', 'Treeseed Test']);
	git(work, ['config', 'user.email', 'treeseed@example.com']);
	writeTenantFiles(work);
	if (packages) {
		gitAllowFile(work, ['submodule', 'add', packages.sdk.origin, 'packages/sdk']);
		gitAllowFile(work, ['submodule', 'add', packages.ui.origin, 'packages/ui']);
		gitAllowFile(work, ['submodule', 'add', packages.core.origin, 'packages/core']);
		gitAllowFile(work, ['submodule', 'add', packages.admin.origin, 'packages/admin']);
		gitAllowFile(work, ['submodule', 'add', packages.cli.origin, 'packages/cli']);
		gitAllowFile(work, ['submodule', 'add', packages.agent.origin, 'packages/agent']);
		gitAllowFile(work, ['submodule', 'add', packages.api.origin, 'packages/api']);
		gitAllowFile(work, ['submodule', 'add', packages.treedx.origin, 'packages/treedx']);
		for (const dirName of ['sdk', 'ui', 'core', 'admin', 'cli', 'agent', 'api', 'treedx']) {
			const packageRoot = resolve(work, 'packages', dirName);
			git(packageRoot, ['config', 'user.name', 'Treeseed Test']);
			git(packageRoot, ['config', 'user.email', 'treeseed@example.com']);
		}
		writeRootWorkspaceManifests(work, ['sdk', 'ui', 'core', 'admin', 'cli', 'agent', 'api', 'treedx']);
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
export function workflowFor(cwd: string) {
	return new WorkflowSdk({ cwd, write: () => {} });
}
export function setPackageVersion(repoDir: string, version: string) {
	const packageJsonPath = resolve(repoDir, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	packageJson.version = version;
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
	git(repoDir, ['add', 'package.json']);
	git(repoDir, ['commit', '-m', `test: set version ${version}`]);
	git(repoDir, ['push', 'origin', 'staging']);
}

