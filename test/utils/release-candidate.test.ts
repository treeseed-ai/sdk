import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildReleaseCandidateFingerprint,
	collectReleaseCandidateOutputFailures,
	runReleaseCandidateGate,
} from '../../src/operations/services/release-candidate.ts';
import {
	discoverTreeseedPackageAdapters,
	planTreeseedPackageDevelopmentImage,
} from '../../src/operations/services/package-adapters.ts';
import {
	githubRepositoryCredentialEnvName,
	resolveGitHubCredentialForRepository,
} from '../../src/operations/services/github-credentials.ts';
import { resolveTreeseedEnvironmentRegistry } from '../../src/platform/environment.ts';

const roots: string[] = [];

function makeWorkspace() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-release-candidate-'));
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
	writeFileSync(resolve(root, 'packages', 'sdk', 'drizzle', 'market', '0000_treeseed_control_plane.sql'), '-- market pg schema\n', 'utf8');
	return root;
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
	writeFileSync(resolve(root, 'packages', 'treedx', '.github', 'workflows', 'dev-image.yml'), 'name: Dev Image\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'treedx', '.github', 'workflows', 'release-gate.yml'), 'name: Release Gate\n', 'utf8');
	writeFileSync(resolve(root, 'packages', 'treedx', 'treeseed.package.yaml'), `id: treedx
name: TreeDX
kind: beam-elixir-rust
repository: treeseed-ai/treedx
versionSource: apps/api/mix.exs
image: treeseed/treedx
verify:
  fast: scripts/test-treedx-fast.sh
  local: scripts/test-all.sh
  release: scripts/release-gate.sh
developmentImages:
  workflow: dev-image.yml
  defaultBranch: staging
  tagPrefix: dev
  movingTag: true
  architectures:
    - amd64
    - arm64
  hosting:
    app: api
    environment: staging
    envVar: TREESEED_PUBLIC_TREEDX_IMAGE_REF
`, 'utf8');
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
		expect(first.policyVersion).toBe('package-adapters-v1');
	});

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

	it('plans TreeDX development images from package metadata', () => {
		const root = makeWorkspace();
		addTreeDxPackage(root);
		spawnSync('git', ['init'], { cwd: resolve(root, 'packages', 'treedx') });
		spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: resolve(root, 'packages', 'treedx') });
		spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: resolve(root, 'packages', 'treedx') });
		spawnSync('git', ['add', '.'], { cwd: resolve(root, 'packages', 'treedx') });
		spawnSync('git', ['commit', '-m', 'init'], { cwd: resolve(root, 'packages', 'treedx') });

		const plan = planTreeseedPackageDevelopmentImage(root, 'treedx', { branch: 'HEAD' });

		expect(plan.repository).toBe('treeseed-ai/treedx');
		expect(plan.workflow).toBe('dev-image.yml');
		expect(plan.refs.imageRef).toMatch(/^treeseed\/treedx:dev-head-[a-f0-9]{12}$/u);
		expect(plan.hosting?.overrideEnvVar).toBe('TREESEED_PUBLIC_TREEDX_IMAGE_REF');
	});

	it('normalizes and resolves repository-scoped GitHub credentials', () => {
		expect(githubRepositoryCredentialEnvName('treeseed-ai/treedx')).toBe('TREESEED_GITHUB_TOKEN_TREESEED_AI_TREEDX');
		expect(githubRepositoryCredentialEnvName('https://github.com/treeseed-ai/treedx.git')).toBe('TREESEED_GITHUB_TOKEN_TREESEED_AI_TREEDX');

		const repositoryCredential = resolveGitHubCredentialForRepository('treeseed-ai/treedx', {
			values: {
				GH_TOKEN: 'root-token',
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
			values: { GH_TOKEN: 'root-token' },
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
		expect(report.checks.find((check) => check.name === 'package-release-readiness')?.detail).toContain('treedx (beam-elixir-rust)');
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
