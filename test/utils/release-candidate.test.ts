import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildReleaseCandidateFingerprint,
	runReleaseCandidateGate,
} from '../../src/operations/services/release-candidate.ts';

const roots: string[] = [];

function makeWorkspace() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-release-candidate-'));
	roots.push(root);
	mkdirSync(resolve(root, 'packages', 'sdk'), { recursive: true });
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
	writeFileSync(resolve(root, 'migrations', '0007_site_web_sessions.sql'), '-- web sessions\n', 'utf8');
	writeFileSync(resolve(root, 'migrations', '0014_better_auth_integer_timestamps.sql'), '-- auth timestamps\n', 'utf8');
	return root;
}

describe('release candidate verification', () => {
	beforeEach(() => {
		vi.stubEnv('TREESEED_GITHUB_AUTOMATION_MODE', 'stub');
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
		expect(report.checks.find((check) => check.name === 'production-dependency-rehearsal')?.detail).toContain('Rehearsed stable replacements');
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
