import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportTreeseedCodebase } from '../../src/operations/services/export-runtime.ts';

const tempRoots: string[] = [];

function createExportFixture(options: { bundledPath?: string; ignorePattern?: string } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-export-runtime-'));
	tempRoots.push(root);

	mkdirSync(resolve(root, 'src', 'nested'), { recursive: true });
	mkdirSync(resolve(root, '.treeseed', 'exports'), { recursive: true });
	writeFileSync(resolve(root, 'src', 'nested', 'index.ts'), 'export const nested = true;\n');
	writeFileSync(resolve(root, 'src', 'nested', 'ignored.tmp'), 'should not appear\n');
	writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: Export Test
slug: export-test
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
export:
  ignore:
    - "${options.ignorePattern ?? '**/*.tmp'}"
${options.bundledPath ? `  bundledPaths:\n    - "${options.bundledPath}"\n` : ''}`, 'utf8');
	writeFileSync(resolve(root, '.treeseed', 'exports', 'old.md'), 'old export should never be included\n', 'utf8');

	if (options.bundledPath) {
		const bundleRoot = resolve(root, options.bundledPath);
		mkdirSync(bundleRoot, { recursive: true });
		writeFileSync(resolve(bundleRoot, 'package.json'), JSON.stringify({ name: '@test/bundle', version: '0.0.1' }, null, 2));
		writeFileSync(resolve(bundleRoot, 'index.ts'), 'export const bundled = true;\n');
	}

	return root;
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('export runtime', () => {
	it('exports markdown snapshots with ignored export artifacts and configured ignore patterns', async () => {
		const root = createExportFixture();
		const exported = await exportTreeseedCodebase({
			directory: resolve(root, 'src', 'nested'),
		});

		expect(exported.directory).toBe(resolve(root, 'src', 'nested'));
		expect(exported.outputPath).toMatch(/\.treeseed\/exports\/.+-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/);
		expect(exported.branch).toBe('detached');
		expect(exported.ignorePatterns).toContain('**/.treeseed/exports/**');
		expect(exported.ignorePatterns).toContain('**/*.tmp');

		const output = readFileSync(exported.outputPath, 'utf8');
		expect(output).toContain('## File: index.ts');
		expect(output).toContain('export const nested = true;');
		expect(output).not.toContain('ignored.tmp');
		expect(output).not.toContain('old export should never be included');
	}, 15000);

	it('includes configured bundled paths when they exist and ignores missing ones', async () => {
		const root = createExportFixture({ bundledPath: 'packages/sdk' });
		const exported = await exportTreeseedCodebase({
			directory: resolve(root, 'src'),
		});

		expect(exported.includedBundlePaths).toEqual([resolve(root, 'packages', 'sdk')]);
		const output = readFileSync(exported.outputPath, 'utf8');
		expect(output).toContain('[src]/');
		expect(output).toContain('[sdk]/');
		expect(output).toContain('## File: nested/index.ts');
		expect(output).toContain('export const bundled = true;');

		writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: Export Test
slug: export-test
siteUrl: https://example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
export:
  bundledPaths:
    - "packages/missing"
`, 'utf8');
		const exportedMissing = await exportTreeseedCodebase({
			directory: resolve(root, 'src'),
		});
		expect(exportedMissing.includedBundlePaths).toEqual([]);
	}, 15000);
});
