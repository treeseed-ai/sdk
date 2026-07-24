import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPackageArtifact, hydratePackageArtifacts, verifyPackageArtifact } from '../../../src/operations/services/packages/package-artifacts.ts';
import { runGitText } from '../../../src/operations/services/operations/git-runner.ts';

const roots: string[] = [];

function fixture() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-package-artifact-'));
	roots.push(root);
	writeFileSync(resolve(root, 'package.json'), `${JSON.stringify({
		name: '@treeseed/artifact-fixture',
		version: '1.2.3',
		files: ['index.js'],
		scripts: { prepack: 'node -e "process.exit(91)"' },
	}, null, 2)}\n`);
	writeFileSync(resolve(root, 'index.js'), 'export const value = 42;\n');
	runGitText(['init'], { cwd: root, mode: 'write' });
	runGitText(['config', 'user.email', 'test@treeseed.local'], { cwd: root, mode: 'write' });
	runGitText(['config', 'user.name', 'Treeseed Test'], { cwd: root, mode: 'write' });
	runGitText(['add', '.'], { cwd: root, mode: 'write' });
	runGitText(['commit', '-m', 'fixture'], { cwd: root, mode: 'write' });
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('package artifacts', () => {
	it('builds and verifies an exact-source npm tarball', () => {
		const root = fixture();
		const result = buildPackageArtifact({ packageRoot: root, outputDir: resolve(root, 'artifacts') });
		expect(result.manifest.packageName).toBe('@treeseed/artifact-fixture');
		expect(result.manifest.sourceSha).toMatch(/^[0-9a-f]{40}$/u);
		expect(result.manifest.sha256).toMatch(/^[0-9a-f]{64}$/u);
		expect(verifyPackageArtifact({ manifestPath: result.manifestPath })).toMatchObject({ ok: true });
	});

	it('rejects a tarball that no longer matches its manifest', () => {
		const root = fixture();
		const result = buildPackageArtifact({ packageRoot: root, outputDir: resolve(root, 'artifacts') });
		writeFileSync(result.artifactPath, `${readFileSync(result.artifactPath, 'utf8')}corrupt`);
		expect(() => verifyPackageArtifact({ manifestPath: result.manifestPath })).toThrow(/integrity check failed/u);
	});

	it('hydrates verified artifacts into a project without changing its lockfile', () => {
		const root = fixture();
		const artifactsRoot = resolve(root, 'candidate-artifacts');
		buildPackageArtifact({ packageRoot: root, outputDir: resolve(artifactsRoot, 'fixture') });
		const projectRoot = resolve(root, 'consumer');
		mkdirSync(projectRoot);
		writeFileSync(resolve(projectRoot, 'package.json'), `${JSON.stringify({ name: 'artifact-consumer', private: true }, null, 2)}\n`);
		const result = hydratePackageArtifacts({ artifactsRoot, projectRoot });
		expect(result.packages.map((entry) => entry.packageName)).toEqual(['@treeseed/artifact-fixture']);
		expect(JSON.parse(readFileSync(resolve(projectRoot, 'node_modules/@treeseed/artifact-fixture/package.json'), 'utf8')).version).toBe('1.2.3');
		expect(() => readFileSync(resolve(projectRoot, 'package-lock.json'))).toThrow();
	});
});
