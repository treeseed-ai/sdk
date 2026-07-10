import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTreeseedPackageArtifact, verifyTreeseedPackageArtifact } from '../../src/operations/services/package-artifacts.ts';
import { runTreeseedGitText } from '../../src/operations/services/git-runner.ts';

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
	runTreeseedGitText(['init'], { cwd: root, mode: 'write' });
	runTreeseedGitText(['config', 'user.email', 'test@treeseed.local'], { cwd: root, mode: 'write' });
	runTreeseedGitText(['config', 'user.name', 'Treeseed Test'], { cwd: root, mode: 'write' });
	runTreeseedGitText(['add', '.'], { cwd: root, mode: 'write' });
	runTreeseedGitText(['commit', '-m', 'fixture'], { cwd: root, mode: 'write' });
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('package artifacts', () => {
	it('builds and verifies an exact-source npm tarball', () => {
		const root = fixture();
		const result = buildTreeseedPackageArtifact({ packageRoot: root, outputDir: resolve(root, 'artifacts') });
		expect(result.manifest.packageName).toBe('@treeseed/artifact-fixture');
		expect(result.manifest.sourceSha).toMatch(/^[0-9a-f]{40}$/u);
		expect(result.manifest.sha256).toMatch(/^[0-9a-f]{64}$/u);
		expect(verifyTreeseedPackageArtifact({ manifestPath: result.manifestPath })).toMatchObject({ ok: true });
	});

	it('rejects a tarball that no longer matches its manifest', () => {
		const root = fixture();
		const result = buildTreeseedPackageArtifact({ packageRoot: root, outputDir: resolve(root, 'artifacts') });
		writeFileSync(result.artifactPath, `${readFileSync(result.artifactPath, 'utf8')}corrupt`);
		expect(() => verifyTreeseedPackageArtifact({ manifestPath: result.manifestPath })).toThrow(/integrity check failed/u);
	});
});
