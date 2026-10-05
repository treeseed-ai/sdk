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
		const identity = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../package.json'), 'utf8')) as {
			name: string; version: string; exports: Record<string, { types: string; default: string }>;
		};
		expect(identity).not.toHaveProperty('types');
		expect(Object.hasOwn(identity.exports, '.')).toBe(false);
		try {
			for (const role of ['actor', 'reviewer', 'valid-root-types', 'missing', 'wrong-identity', 'missing-root-types', 'unsafe-root-types', 'untyped-export']) {
				const cwd = join(root, role); mkdirSync(join(cwd, 'dist'), { recursive: true });
				const exports = structuredClone(identity.exports);
				if (role === 'untyped-export') delete (exports['./standards'] as Partial<{ types: string }>).types;
				writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: role === 'wrong-identity' ? 'other-package' : identity.name, version: identity.version,
					...(role === 'valid-root-types' ? { types: identity.exports['./standards']!.types } : {}),
					...(role === 'missing-root-types' ? { types: './dist/absent.d.ts' } : {}),
					...(role === 'unsafe-root-types' ? { types: '../outside.d.ts' } : {}), exports, files: ['dist'] }));
				for (const target of Object.values(identity.exports).flatMap(entry => Object.values(entry))) {
					if (role === 'missing' && target === identity.exports['./standards']!.types) continue;
					const output = join(cwd, target); mkdirSync(resolve(output, '..'), { recursive: true });
					writeFileSync(output, target.endsWith('.d.ts') ? 'export declare const value: number;' : 'export const value = 1;');
				}
				const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { cwd, encoding: 'utf8', timeout: 15000 })) as Array<{ filename: string }>;
				const artifact = packed[0]!.filename;
				const inspect = () => execFileSync(process.execPath, ['--import', resolve(import.meta.dirname, '../../../node_modules/tsx/dist/loader.mjs'), command, '--archive', artifact],
					{ cwd, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
				if (!['actor', 'reviewer', 'valid-root-types'].includes(role)) { expect(inspect).toThrow(); continue; }
				expect(JSON.parse(inspect())).toMatchObject({ ok: true, exportTargets: Object.keys(identity.exports).length * 2, declarations: Object.keys(identity.exports).length,
					archiveDigest: `sha256:${createHash('sha256').update(readFileSync(join(cwd, artifact))).digest('hex')}` });
			}
			// Pack this candidate's actual build outputs as well as the negative fixtures.
			const actual = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
				{ cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8', timeout: 15000 })) as Array<{ filename: string }>;
			const output = execFileSync(process.execPath, ['--import', resolve(import.meta.dirname, '../../../node_modules/tsx/dist/loader.mjs'),
				command, '--archive', join(root, actual[0]!.filename)], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
			expect(JSON.parse(output)).toMatchObject({ ok: true, exportTargets: Object.keys(identity.exports).length * 2 });
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
