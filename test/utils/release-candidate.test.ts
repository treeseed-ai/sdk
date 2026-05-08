import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildReleaseCandidateFingerprint,
	collectReleaseCandidateOutputFailures,
	runReleaseCandidateGate,
} from '../../src/operations/services/release-candidate.ts';

const roots: string[] = [];

function makeWorkspace() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-release-candidate-'));
	roots.push(root);
	mkdirSync(resolve(root, 'packages', 'sdk'), { recursive: true });
	mkdirSync(resolve(root, 'packages', 'sdk', '.github', 'workflows'), { recursive: true });
	mkdirSync(resolve(root, 'migrations'), { recursive: true });
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
	writeFileSync(resolve(root, 'migrations', '0007_site_web_sessions.sql'), '-- web sessions\n', 'utf8');
	writeFileSync(resolve(root, 'migrations', '0014_better_auth_integer_timestamps.sql'), '-- auth timestamps\n', 'utf8');
	return root;
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
		expect(first.policyVersion).toBe('strict-output-v1');
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
