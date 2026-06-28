import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildReleaseCandidateFingerprint,
	buildReleaseCandidateTopologyFingerprint,
	collectReleaseCandidateOutputFailures,
	isRootWebReleaseCandidateEntry,
	runReleaseCandidateGate,
} from '../../src/operations/services/release-candidate.ts';
import {
	discoverTreeseedPackageAdapters,
	planTreeseedPackageDevelopmentImage,
} from '../../src/operations/services/package-adapters.ts';
import { buildReleaseGraph } from '../../src/operations/services/release-graph-rehearsal.ts';
import {
	githubRepositoryCredentialEnvName,
	resolveGitHubCredentialForRepository,
} from '../../src/operations/services/github-credentials.ts';
import { resolveTreeseedEnvironmentRegistry } from '../../src/platform/environment.ts';

const roots: string[] = [];

function testGitEnv() {
	const env = { ...process.env };
	for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'] as const) {
		delete env[key];
	}
	env.GIT_ALLOW_PROTOCOL = env.GIT_ALLOW_PROTOCOL ?? 'file:git:ssh:https';
	return env;
}

function runTestGit(args: string[], options: { cwd?: string; encoding?: BufferEncoding } = {}) {
	const result = spawnSync('git', args, {
		cwd: options.cwd,
		encoding: options.encoding,
		env: testGitEnv(),
	});
	if (result.status !== 0) {
		const stderr = options.encoding ? result.stderr : result.stderr?.toString('utf8');
		const stdout = options.encoding ? result.stdout : result.stdout?.toString('utf8');
		throw new Error((stderr || stdout || `git ${args.join(' ')} failed`).trim());
	}
	return result;
}

function testTempBase() {
	const base = resolve('.treeseed', 'test-tmp');
	mkdirSync(base, { recursive: true });
	return base;
}

function makeWorkspace() {
	const root = mkdtempSync(join(testTempBase(), 'treeseed-release-candidate-'));
	roots.push(root);
	mkdirSync(resolve(root, 'packages', 'sdk'), { recursive: true });
	mkdirSync(resolve(root, 'packages', 'sdk', '.github', 'workflows'), { recursive: true });
	mkdirSync(resolve(root, 'packages', 'sdk', 'drizzle', 'd1'), { recursive: true });
	mkdirSync(resolve(root, 'packages', 'sdk', 'drizzle', 'market'), { recursive: true });
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({
		name: '@treeseed/market',
		version: '1.0.0',
		private: true,
		workspaces: ['packages/*'],
		dependencies: {
			'@treeseed/sdk': 'git+https://github.com/treeseed/sdk.git#0.4.13-dev.feature-demo.1',
		},
	}, null, 2), 'utf8');
	writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({
		name: '@treeseed/market',
		lockfileVersion: 3,
		packages: {},
	}, null, 2), 'utf8');
	writeFileSync(resolve(root, 'packages', 'sdk', 'package.json'), JSON.stringify({
		name: '@treeseed/sdk',
		version: '0.4.13-dev.feature-demo.1',
		scripts: {
			'verify:local': 'node -e "process.exit(0)"',
			'release:publish': 'node -e "process.exit(0)"',
		},
	}, null, 2), 'utf8');
	writeFileSync(resolve(root, 'packages', 'sdk', '.github', 'workflows', 'publish.yml'), 'name: Publish\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'sdk', 'drizzle', 'd1', '0000_treeseed_d1.sql'), '-- d1 schema\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'sdk', 'drizzle', 'market', '0000_market_control_plane.sql'), '-- market pg schema\n', 'utf8');
	return root;
}

function writeValidWorkspaceLockfile(root: string) {
	const sdkSpec = spawnSync(process.execPath, ['-e', 'process.stdout.write(require(process.argv[1]).dependencies["@treeseed/sdk"])', resolve(root, 'package.json')], {
		encoding: 'utf8',
	}).stdout.trim();
	writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({
		name: '@treeseed/market',
		version: '1.0.0',
		lockfileVersion: 3,
		packages: {
			'': {
				name: '@treeseed/market',
				version: '1.0.0',
				workspaces: ['packages/*'],
				dependencies: {
					'@treeseed/sdk': sdkSpec,
				},
			},
			'node_modules/@treeseed/sdk': {
				resolved: 'packages/sdk',
				link: true,
			},
			'packages/sdk': {
				name: '@treeseed/sdk',
				version: '0.4.13-dev.feature-demo.1',
			},
		},
	}, null, 2), 'utf8');
}

function addTreeDxPackage(root: string) {
	mkdirSync(resolve(root, 'packages', 'treedx', 'apps', 'api'), { recursive: true });
	mkdirSync(resolve(root, 'packages', 'treedx', '.github', 'workflows'), { recursive: true });
	mkdirSync(resolve(root, 'packages', 'treedx', 'scripts'), { recursive: true });
	writeFileSync(resolve(root, 'packages', 'treedx', 'apps', 'api', 'mix.exs'), `
defmodule TreeDx.MixProject do
  use Mix.Project
  def project do
    [app: :treedx, version: "0.1.0"]
  end
end
`, 'utf8');
	writeFileSync(resolve(root, 'packages', 'treedx', 'Cargo.toml'), '[workspace]\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'treedx', 'Cargo.lock'), '# lock\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'treedx', 'Dockerfile'), 'FROM scratch\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'treedx', 'scripts', 'test-treedx-fast.sh'), '#!/usr/bin/env bash\nexit 0\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'treedx', 'scripts', 'test-all.sh'), '#!/usr/bin/env bash\nexit 0\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'treedx', 'scripts', 'release-gate.sh'), '#!/usr/bin/env bash\nexit 0\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'treedx', '.github', 'workflows', 'publish.yml'), 'name: Publish Image\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'treedx', '.github', 'workflows', 'release-gate.yml'), 'name: Release Gate\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'treedx', 'treeseed.package.yaml'), `id: treedx
name: TreeDX
kind: beam-elixir-rust
repository: treeseed-ai/treedx
versionSource: apps/api/mix.exs
image: treeseed/treedx
deploymentSource:
  staging: git
  prod: image
verify:
  fast: scripts/test-treedx-fast.sh
  local: scripts/test-all.sh
  release: scripts/release-gate.sh
dockerImages:
  releaseWorkflow: publish.yml
  architectures:
    - amd64
    - arm64
  hosting:
    app: api
    environment: prod
    envVar: TREESEED_PUBLIC_TREEDX_IMAGE_REF
`, 'utf8');
}

function addApiPackage(root: string) {
	mkdirSync(resolve(root, 'packages', 'api'), { recursive: true });
	writeFileSync(resolve(root, 'packages', 'api', 'package.json'), JSON.stringify({
		name: '@treeseed/api',
		version: '0.1.0',
		private: true,
		repository: {
			type: 'git',
			url: 'git+ssh://git@github.com/treeseed-ai/api.git',
		},
		scripts: {
			'verify:local': 'node -e "process.exit(0)"',
		},
	}, null, 2), 'utf8');
}

describe('release candidate verification', () => {
	beforeEach(() => {
		vi.stubEnv('TREESEED_RELEASE_CANDIDATE_REHEARSAL_MODE', 'skip');
		vi.stubEnv('TREESEED_RELEASE_CANDIDATE_CONFIG_PARITY_MODE', 'skip');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		for (const root of roots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('changes the fingerprint when selected packages, planned versions, or lockfiles change', () => {
		const root = makeWorkspace();
		const first = buildReleaseCandidateFingerprint({
			root,
			selectedPackageNames: ['@treeseed/sdk'],
			plannedVersions: { '@treeseed/market': '1.0.1', '@treeseed/sdk': '0.4.13' },
		});
		const changedVersion = buildReleaseCandidateFingerprint({
			root,
			selectedPackageNames: ['@treeseed/sdk'],
			plannedVersions: { '@treeseed/market': '1.0.2', '@treeseed/sdk': '0.4.13' },
		});
		writeFileSync(resolve(root, 'package-lock.json'), `${JSON.stringify({ changed: true })}\n`, 'utf8');
		const changedLockfile = buildReleaseCandidateFingerprint({
			root,
			selectedPackageNames: ['@treeseed/sdk'],
			plannedVersions: { '@treeseed/market': '1.0.1', '@treeseed/sdk': '0.4.13' },
		});
		const changedSelection = buildReleaseCandidateFingerprint({
			root,
			selectedPackageNames: [],
			plannedVersions: { '@treeseed/market': '1.0.1', '@treeseed/sdk': '0.4.13' },
		});

		expect(first.key).not.toBe(changedVersion.key);
		expect(first.key).not.toBe(changedLockfile.key);
		expect(first.key).not.toBe(changedSelection.key);
		expect(first.policyVersion).toBe('package-adapters-v2-hybrid');
	});

	it('does not change topology for internal version and git commit churn', () => {
		const root = makeWorkspace();
		const first = buildReleaseCandidateTopologyFingerprint({
			root,
			selectedPackageNames: ['@treeseed/sdk'],
			plannedVersions: { '@treeseed/market': '1.0.1', '@treeseed/sdk': '0.4.13' },
		});
		const nextCommitRef = '1111111111111111111111111111111111111111';
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: '@treeseed/market',
			version: '1.0.7',
			private: true,
			workspaces: ['packages/*'],
			dependencies: {
				'@treeseed/sdk': `github:treeseed-ai/sdk#${nextCommitRef}`,
			},
		}, null, 2), 'utf8');
		writeFileSync(resolve(root, 'packages', 'sdk', 'package.json'), JSON.stringify({
			name: '@treeseed/sdk',
			version: '0.4.14-dev.demo.1',
			scripts: {
				'verify:local': 'node -e "process.exit(0)"',
				'release:publish': 'node -e "process.exit(0)"',
			},
		}, null, 2), 'utf8');
		const second = buildReleaseCandidateTopologyFingerprint({
			root,
			selectedPackageNames: ['@treeseed/sdk'],
			plannedVersions: { '@treeseed/market': '1.0.2', '@treeseed/sdk': '0.4.14' },
		});

		expect(second.key).toBe(first.key);
	});

	it('changes topology for external dependencies and release scripts', () => {
		const root = makeWorkspace();
		const first = buildReleaseCandidateTopologyFingerprint({
			root,
			selectedPackageNames: ['@treeseed/sdk'],
			plannedVersions: {},
		});
		const nextCommitRef = '2222222222222222222222222222222222222222';
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: '@treeseed/market',
			version: '1.0.0',
			private: true,
			workspaces: ['packages/*'],
			dependencies: {
				'@treeseed/sdk': `github:treeseed-ai/sdk#${nextCommitRef}`,
				astro: '^5.1.0',
			},
		}, null, 2), 'utf8');
		const changedDependency = buildReleaseCandidateTopologyFingerprint({
			root,
			selectedPackageNames: ['@treeseed/sdk'],
			plannedVersions: {},
		});
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: '@treeseed/market',
			version: '1.0.0',
			private: true,
			workspaces: ['packages/*'],
			dependencies: {
				'@treeseed/sdk': `github:treeseed-ai/sdk#${nextCommitRef}`,
				astro: '^5.1.0',
			},
			scripts: {
				'verify:local': 'node verify.mjs',
			},
		}, null, 2), 'utf8');
		const changedScript = buildReleaseCandidateTopologyFingerprint({
			root,
			selectedPackageNames: ['@treeseed/sdk'],
			plannedVersions: {},
		});

		expect(changedDependency.key).not.toBe(first.key);
		expect(changedScript.key).not.toBe(changedDependency.key);
	});

	it('keeps hybrid release-candidate checks lightweight without strict topology proof', async () => {
		const root = makeWorkspace();
		const remote = resolve(root, 'sdk.git');
		const work = resolve(root, 'sdk-work');
		runTestGit(['init', '--bare', remote]);
		runTestGit(['clone', remote, work]);
		runTestGit(['config', 'user.email', 'test@example.com'], { cwd: work });
		runTestGit(['config', 'user.name', 'Test User'], { cwd: work });
		writeFileSync(resolve(work, 'README.md'), 'sdk\n', 'utf8');
		writeFileSync(resolve(work, 'package.json'), JSON.stringify({
			name: '@treeseed/sdk',
			version: '0.4.13-dev.demo.1',
		}, null, 2), 'utf8');
		runTestGit(['add', 'README.md'], { cwd: work });
		runTestGit(['add', 'package.json'], { cwd: work });
		runTestGit(['commit', '-m', 'init'], { cwd: work });
		const commitSha = runTestGit(['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).stdout.trim();
		runTestGit(['push', 'origin', 'HEAD'], { cwd: work });
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: '@treeseed/market',
			version: '1.0.0',
			private: true,
			workspaces: ['packages/*'],
			dependencies: {
				'@treeseed/sdk': `git+file://${remote}#${commitSha}`,
			},
		}, null, 2), 'utf8');
		writeValidWorkspaceLockfile(root);

		const report = await runReleaseCandidateGate({
			root,
			mode: 'hybrid',
			selectedPackageNames: ['@treeseed/sdk'],
			plannedVersions: {
				'@treeseed/market': '1.0.0',
				'@treeseed/sdk': '0.4.13-dev.feature-demo.1',
			},
			allowReuse: false,
		});

		expect(report.status, JSON.stringify({
			failures: report.failures,
			checks: report.checks,
		}, null, 2)).toBe('passed');
		expect(report.mode).toBe('hybrid');
		expect(report.reason).toContain('lightweight checks');
		expect(report.checks.map((check) => check.name)).toContain('hybrid-dependency-readiness');
		expect(report.checks.map((check) => check.name)).not.toContain('production-dependency-rehearsal');
	}, 30000);

	it('discovers TreeDX as a BEAM package adapter', () => {
		const root = makeWorkspace();
		addTreeDxPackage(root);

		const adapters = discoverTreeseedPackageAdapters(root);
		const treedx = adapters.find((adapter) => adapter.id === 'treedx');

		expect(treedx?.kind).toBe('beam-elixir-rust');
		expect(treedx?.version).toBe('0.1.0');
		expect(treedx?.publishTarget).toBe('treeseed/treedx');
		expect(treedx?.metadata.repository).toBe('treeseed-ai/treedx');
		expect(treedx?.verifyCommands.local?.args).toEqual(['scripts/test-all.sh']);
		expect(treedx?.releaseChecks.some((check) => check.kind === 'docker-manifest')).toBe(true);
	});

	it('plans TreeDX staging source builds from package metadata', () => {
		const root = makeWorkspace();
		addTreeDxPackage(root);
		runTestGit(['init'], { cwd: resolve(root, 'packages', 'treedx') });
		runTestGit(['config', 'user.email', 'test@example.com'], { cwd: resolve(root, 'packages', 'treedx') });
		runTestGit(['config', 'user.name', 'Test User'], { cwd: resolve(root, 'packages', 'treedx') });
		runTestGit(['add', '.'], { cwd: resolve(root, 'packages', 'treedx') });
		runTestGit(['commit', '-m', 'init'], { cwd: resolve(root, 'packages', 'treedx') });
		runTestGit(['update-ref', 'refs/remotes/origin/staging', 'HEAD'], { cwd: resolve(root, 'packages', 'treedx') });

		const plan = planTreeseedPackageDevelopmentImage(root, 'treedx', { branch: 'staging' });

		expect(plan.repository).toBe('treeseed-ai/treedx');
		expect(plan.workflow).toBe('source-build');
		expect(plan.refs.imageRef).toBeNull();
		expect(plan.deploymentSource).toMatchObject({
			environment: 'staging',
			mode: 'git',
			repository: 'treeseed-ai/treedx',
			imagePublicationRequired: false,
		});
		expect(plan.hosting).toBeNull();
	});

	it('plans TreeDX production images only from main as semantic image artifacts', () => {
		const root = makeWorkspace();
		addTreeDxPackage(root);
		runTestGit(['init'], { cwd: resolve(root, 'packages', 'treedx') });
		runTestGit(['config', 'user.email', 'test@example.com'], { cwd: resolve(root, 'packages', 'treedx') });
		runTestGit(['config', 'user.name', 'Test User'], { cwd: resolve(root, 'packages', 'treedx') });
		runTestGit(['add', '.'], { cwd: resolve(root, 'packages', 'treedx') });
		runTestGit(['commit', '-m', 'init'], { cwd: resolve(root, 'packages', 'treedx') });
		runTestGit(['branch', '-M', 'main'], { cwd: resolve(root, 'packages', 'treedx') });

		const plan = planTreeseedPackageDevelopmentImage(root, 'treedx', { branch: 'main' });

		expect(plan.deploymentSource).toMatchObject({
			environment: 'prod',
			mode: 'image',
			repository: 'treeseed-ai/treedx',
			imagePublicationRequired: true,
		});
		expect(plan.refs.imageRef).toBe('treeseed/treedx:0.1.0');
		expect(plan.refs.movingImageRef).toBeNull();
		expect(plan.hosting?.overrideEnvVar).toBe('TREESEED_PUBLIC_TREEDX_IMAGE_REF');
		expect(plan.hosting?.override).toEqual({
			TREESEED_PUBLIC_TREEDX_IMAGE_REF: 'treeseed/treedx:0.1.0',
		});
		expect(plan.hosting?.command).toContain('npx trsd hosting apply --environment prod --app api --execute --json');
	});

	it('expands selected release graph packages to upstream dependencies and TreeDX image producers', () => {
		const root = makeWorkspace();
		addTreeDxPackage(root);
		addApiPackage(root);
		writeFileSync(resolve(root, 'packages', 'api', 'package.json'), JSON.stringify({
			name: '@treeseed/api',
			version: '0.1.0',
			private: true,
			dependencies: {
				'@treeseed/sdk': 'workspace:*',
			},
			scripts: {
				'verify:local': 'node -e "process.exit(0)"',
			},
		}, null, 2), 'utf8');

		const graph = buildReleaseGraph(root, ['@treeseed/api']);

		expect(graph.order).toContain('@treeseed/sdk');
		expect(graph.order).toContain('treedx');
		expect(graph.order.at(-1)).toBe('@treeseed/api');
		expect(graph.edges).toEqual(expect.arrayContaining([
			expect.objectContaining({ from: '@treeseed/sdk', to: '@treeseed/api', kind: 'npm-dependency' }),
			expect.objectContaining({ from: 'treedx', to: '@treeseed/api', kind: 'hosting-image-consumer' }),
		]));
	});

	it('does not delete installed package dependencies before release graph verification', () => {
		const source = readFileSync(resolve('src/operations/services/release-graph-rehearsal.ts'), 'utf8');
		expect(source).not.toContain("rmSync(resolve(packageDir, 'node_modules')");
		expect(source).toContain("TREESEED_VERIFY_PACKAGE_ISOLATED: '1'");
		expect(source).toContain('treeseed-release-tarballs');
		expect(source).toContain('file:${STAGED_TARBALL_DIR}/${stagedTarballName}');
		expect(source).toContain("mode: 'file' | 'version'");
		expect(source).toContain('releaseGraphTarballVersion(tarballPath)');
		expect(source).toContain("rewriteInternalDependencies(packageDir, tarballs, 'version')");
		expect(source).toContain("rewriteInternalDependencies(packageDir, tarballs, 'file')");
		expect(source).toContain('ensureIgnoreFilesIncludeStagedTarballs(packageDir)');
		expect(source).toContain("resolve(packageDir, '.npmignore')");
		expect(source).toContain('!${STAGED_TARBALL_DIR}/*.tgz');
		expect(source).toContain("'.treeseed', 'tmp', 'release-graph'");
		expect(source).toContain('TREESEED_RELEASE_GRAPH_TMPDIR');
		expect(source).toContain("'.treeseed', 'tmp', 'actions'");
		expect(source).toContain('TMPDIR: env.TMPDIR ?? tempDir');
		expect(source).not.toContain('npm_config_tmp');

		for (const packageName of ['cli', 'agent', 'api']) {
			const verifier = readFileSync(resolve('..', packageName, 'scripts', 'release-verify.ts'), 'utf8');
			expect(verifier).toContain('TREESEED_VERIFY_PACKAGE_ISOLATED');
			expect(verifier).toContain('file:treeseed-release-tarballs');
		}
	});

	it('normalizes and resolves repository-scoped GitHub credentials', () => {
		expect(githubRepositoryCredentialEnvName('treeseed-ai/treedx')).toBe('TREESEED_GITHUB_TOKEN_TREESEED_AI_TREEDX');
		expect(githubRepositoryCredentialEnvName('https://github.com/treeseed-ai/treedx.git')).toBe('TREESEED_GITHUB_TOKEN_TREESEED_AI_TREEDX');

		const repositoryCredential = resolveGitHubCredentialForRepository('treeseed-ai/treedx', {
			values: {
				TREESEED_GITHUB_TOKEN: 'root-token',
				TREESEED_GITHUB_TOKEN_TREESEED_AI_TREEDX: 'repo-token',
			},
			env: {},
		});
		expect(repositoryCredential).toMatchObject({
			envName: 'TREESEED_GITHUB_TOKEN_TREESEED_AI_TREEDX',
			source: 'repository',
			fallbackUsed: false,
			configured: true,
		});
		expect(repositoryCredential.token).toBe('repo-token');

		const fallbackCredential = resolveGitHubCredentialForRepository('treeseed-ai/treedx', {
			values: { TREESEED_GITHUB_TOKEN: 'root-token' },
			env: {},
		});
		expect(fallbackCredential).toMatchObject({
			envName: 'TREESEED_GITHUB_TOKEN_TREESEED_AI_TREEDX',
			source: 'fallback',
			fallbackUsed: true,
			configured: true,
		});
		expect(fallbackCredential.token).toBe('root-token');
	});

	it('adds package repository credentials to the environment registry', () => {
		const root = makeWorkspace();
		addTreeDxPackage(root);
		addApiPackage(root);

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				__tenantRoot: root,
			} as any,
			plugins: [],
		});

		const entry = registry.entries.find((candidate) => candidate.id === 'TREESEED_GITHUB_TOKEN_TREESEED_AI_TREEDX');
		expect(entry).toMatchObject({
			group: 'github',
			sensitivity: 'secret',
			targets: ['local-runtime'],
			storage: 'shared',
		});
		const apiEntry = registry.entries.find((candidate) => candidate.id === 'TREESEED_GITHUB_TOKEN_TREESEED_AI_API');
		expect(apiEntry).toMatchObject({
			group: 'github',
			sensitivity: 'secret',
			targets: ['local-runtime'],
			storage: 'shared',
		});
	});

	it('scopes root web release-candidate config away from API and TreeDX package secrets', () => {
		expect(isRootWebReleaseCandidateEntry({
			id: 'TREESEED_EDITORIAL_PREVIEW_SECRET',
			group: 'cloudflare',
		})).toBe(true);
		expect(isRootWebReleaseCandidateEntry({
			id: 'TREESEED_CREDENTIAL_SESSION_SECRET',
			group: 'hosting',
			serviceTargets: ['api', 'operationsRunner'],
		})).toBe(false);
		expect(isRootWebReleaseCandidateEntry({
			id: 'TREEDX_JWT_HS256_SECRET',
			group: 'railway',
			serviceTargets: ['publicTreeDxNode'],
		})).toBe(false);
		expect(isRootWebReleaseCandidateEntry({
			id: 'TREESEED_DOCKERHUB_TOKEN',
			group: 'docker',
		})).toBe(false);
	});

	it('checks BEAM package readiness without npm pack', async () => {
		const root = makeWorkspace();
		addTreeDxPackage(root);

		const report = await runReleaseCandidateGate({
			root,
			selectedPackageNames: ['@treeseed/sdk', 'treedx'],
			plannedVersions: { '@treeseed/market': '1.0.1', '@treeseed/sdk': '0.4.13', treedx: '0.1.0' },
			allowReuse: false,
		});

		expect(report.status).toBe('passed');
		expect(report.localProof?.graph.order).toContain('treedx');
		expect(report.localProof?.artifacts).toEqual(expect.arrayContaining([
			expect.objectContaining({ packageId: 'treedx', proofType: 'verify-script', status: 'passed' }),
		]));
		expect(report.failures.some((failure) => failure.code === 'npm_pack_dry_run_failed')).toBe(false);
	});

	it('classifies error-grade rehearsal output even when a command exits cleanly', () => {
		expect(collectReleaseCandidateOutputFailures(
			'stderr | test/lib/auth-flow.test.ts > market auth page flow > submits hosted email registration',
		)).toContain('Captured test stderr: stderr | test/lib/auth-flow.test.ts > market auth page flow > submits hosted email registration');
		expect(collectReleaseCandidateOutputFailures(
			'2026-05-08T00:49:50.570Z ERROR [Better Auth]: Failed to run background task: Error: SMTP must be configured.',
		).some((failure) => failure.includes('Error output'))).toBe(true);
		expect(collectReleaseCandidateOutputFailures(
			'[WARN] [vite] [plugin vite:resolve] Module "url" has been externalized for browser compatibility.',
		)).toEqual([]);
	});

	it('allows selected dev references when a stable planned replacement exists', async () => {
		const root = makeWorkspace();

		const report = await runReleaseCandidateGate({
			root,
			selectedPackageNames: ['@treeseed/sdk'],
			plannedVersions: { '@treeseed/market': '1.0.1', '@treeseed/sdk': '0.4.13' },
			allowReuse: false,
		});

		expect(report.status).toBe('passed');
		expect(report.checks.find((check) => check.name === 'production-dependency-rehearsal')?.detail).toContain('Skipped clean install rehearsal by request');
	});

	it('rejects dev references without a selected stable replacement', async () => {
		const root = makeWorkspace();

		const report = await runReleaseCandidateGate({
			root,
			selectedPackageNames: [],
			plannedVersions: { '@treeseed/market': '1.0.1' },
			allowReuse: false,
		});

		expect(report.status).toBe('failed');
		expect(report.failures.some((failure) => failure.code === 'internal_dev_references')).toBe(true);
	});
});
