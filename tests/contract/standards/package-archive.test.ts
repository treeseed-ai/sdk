import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { assertPackageExportTargets } from '../../../scripts/standards/acceptance/package-exports.ts';

describe('portable packed SDK exports and declarations', () => {
	it('replays archive inspection in independent npm workspaces and rejects an omitted declaration', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-archive-test-'));
		const command = resolve(import.meta.dirname, '../../../scripts/standards/package-acceptance.ts');
		const identity = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../package.json'), 'utf8')) as { name: string; version: string };
		try {
			for (const role of ['actor', 'reviewer', 'missing', 'wrong-identity']) {
				const cwd = join(root, role); mkdirSync(join(cwd, 'dist'), { recursive: true });
				const exports = Object.fromEntries(['.', './standards', './standards/typescript', './standards/openapi', './standards/mcp', './operator-contracts', './treedx', './treeai']
					.map(name => [name, { types: './dist/index.d.ts', default: './dist/index.js' }]));
				writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: role === 'wrong-identity' ? 'other-package' : identity.name, version: identity.version,
					types: './dist/index.d.ts', exports, files: ['dist'] }));
				writeFileSync(join(cwd, 'dist/index.js'), 'export const value = 1;');
				if (role !== 'missing') writeFileSync(join(cwd, 'dist/index.d.ts'), 'export declare const value: number;');
				const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { cwd, encoding: 'utf8', timeout: 15000 })) as Array<{ filename: string }>;
				const artifact = packed[0]!.filename;
				const inspect = () => execFileSync(process.execPath, ['--import', resolve(import.meta.dirname, '../../../node_modules/tsx/dist/loader.mjs'), command, '--archive', artifact],
					{ cwd, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
				if (['missing', 'wrong-identity'].includes(role)) { expect(inspect).toThrow(); continue; }
				expect(JSON.parse(inspect())).toMatchObject({ ok: true, exportTargets: 2, declarations: 1,
					archiveDigest: `sha256:${createHash('sha256').update(readFileSync(join(cwd, artifact))).digest('hex')}` });
			}
		} finally { rmSync(root, { recursive: true, force: true }); }
	}, 45000);
	it('uses one export validation path for source and archive and rejects unsafe or absent targets', () => {
		expect(assertPackageExportTargets({ types: './dist/index.d.ts' }, path => path === './dist/index.d.ts')).toEqual(['./dist/index.d.ts']);
		for (const path of ['../other.d.ts', './dist/../../other.d.ts', './dist\\other.d.ts'])
			expect(() => assertPackageExportTargets({ types: path }, () => true)).toThrow('package-relative');
		expect(() => assertPackageExportTargets({}, () => true)).toThrow('declare build outputs');
		expect(() => assertPackageExportTargets({ types: './missing.d.ts' }, () => false)).toThrow('missing build outputs');
	});
});
