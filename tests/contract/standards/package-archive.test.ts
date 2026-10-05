import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { assertPackageCandidateOutputs, assertPackageExportTargets } from '../../../scripts/standards/acceptance/package-exports.ts';

describe('portable packed SDK exports and declarations', () => {
	it('installed native SDK archive enforces exact report Note identifier and subject authority without changing packaged bytes', () => {
		const candidate = resolve(import.meta.dirname, '../../..');
		const manifest = readFileSync(join(candidate, 'package.json'));
		const native = join(candidate, 'tests/unit/content/architecture/closeout-native.ts'), nativeBytes = readFileSync(native);
		const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-installed-report-'));
		const subject = { store: 'postgresql', model: 'workday', id: 'bounded-workday' };
		const note = { schemaVersion: 'treeseed.note/v1', id: 'report', projectId: 'sdk', classification: 'workday-report',
			subjectRefs: [subject], body: 'Controlled archived public validator input, not a managed report.', createdAt: '2026-10-05T00:00:00.000Z' };
		const entries: Array<{ data: Record<string, unknown>; valid: boolean }> = [...['id', 'projectId'].flatMap(field => [
			{ data: { ...note, [field]: 'a'.repeat(200) }, valid: true },
			...['a'.repeat(201), ' padded ', '', null].map(value => ({ data: { ...note, [field]: value }, valid: false })),
			{ data: Object.fromEntries(Object.entries(note).filter(([key]) => key !== field)), valid: false },
		]),
			{ data: note, valid: true },
			{ data: { ...note, subjectRefs: [subject, subject] }, valid: false },
			{ data: { ...note, subjectRefs: [] }, valid: false },
			{ data: { ...note, createdAt: 'not-a-clock' }, valid: false },
			{ data: { ...note, unknownAuthority: true }, valid: false },
		], held = structuredClone(entries);
		try {
			const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
				{ cwd: candidate, encoding: 'utf8', timeout: 15000 })) as Array<{ filename: string; files: Array<{ path: string }> }>;
			expect(packed).toHaveLength(1);
			const archive = join(root, packed[0]!.filename), bytes = readFileSync(archive);
			const extracted = join(root, 'extracted'); mkdirSync(extracted);
			execFileSync('tar', ['-xzf', archive, '-C', extracted], { timeout: 15000 });
			const install = join(root, 'installed'); mkdirSync(install);
			execFileSync('npm', ['install', '--prefix', install, '--no-save', '--package-lock=false', '--ignore-scripts',
				'--offline', '--no-audit', '--no-fund', archive], { encoding: 'utf8', timeout: 15000 });
			const installed = join(install, 'node_modules/@treeseed/sdk');
			const child = spawnSync(process.execPath, ['--import', resolve(candidate, 'node_modules/tsx/dist/loader.mjs'),
				native, 'installed-note-inventory', join(install, 'package.json')], {
				input: JSON.stringify(entries.map(entry => entry.data)), encoding: 'utf8', timeout: 15000,
			});
			expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
			const output: unknown = JSON.parse(child.stdout);
			if (!output || typeof output !== 'object' || !('entry' in output) || !('observations' in output) || !Array.isArray(output.observations)) {
				throw new Error('Installed public entry and actual native validator observations required.');
			}
			expect(output.entry).toBe(join(installed, 'dist/content/validation/index.js'));
			expect(output.observations).toHaveLength(entries.length);
			for (const [index, entry] of entries.entries()) expect(output.observations[index]).toMatchObject(entry.valid ? { ok: true, data: entry.data } : { ok: false });
			for (const file of packed[0]!.files) expect(readFileSync(join(installed, file.path))).toEqual(readFileSync(join(extracted, 'package', file.path)));
			expect(readFileSync(archive)).toEqual(bytes); expect(readFileSync(native)).toEqual(nativeBytes);
			expect(readFileSync(join(candidate, 'package.json'))).toEqual(manifest); expect(entries).toEqual(held);
		} finally { rmSync(root, { recursive: true, force: true }); }
	}, 45000);
	it('public archive acceptance rejects changed export and declaration identity against the same untouched candidate', () => {
		const candidate = resolve(import.meta.dirname, '../../..');
		const manifestBytes = readFileSync(join(candidate, 'package.json'));
		const identity = JSON.parse(manifestBytes.toString('utf8')) as { exports: Record<string, { types: string; default: string }> };
		const targets = Object.values(identity.exports).flatMap(entry => Object.values(entry));
		const sourceBytes = targets.map(target => ({ target, bytes: readFileSync(join(candidate, target)) }));
		const root = mkdtempSync(join(tmpdir(), 'treeseed-sdk-candidate-archive-'));
		try {
			const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
				{ cwd: candidate, encoding: 'utf8', timeout: 15000 })) as Array<{ filename: string }>;
			expect(packed).toHaveLength(1);
			const archive = join(root, packed[0]!.filename), originalBytes = readFileSync(archive);
			const inspect = (path: string) => {
				const result = spawnSync('npm', ['run', 'standards:acceptance', '--', '--archive', path],
					{ cwd: candidate, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
				expect(result.error).toBeUndefined(); expect(result.signal).toBeNull();
				return result;
			};
			const valid = inspect(archive);
			expect(valid.status).toBe(0);
			expect(JSON.parse(valid.stdout.trim().split('\n').at(-1)!)).toMatchObject({ ok: true,
				archiveDigest: `sha256:${createHash('sha256').update(originalBytes).digest('hex')}`, exportTargets: targets.length });
			for (const mutation of ['export-map', 'declaration']) {
				const workspace = join(root, mutation); mkdirSync(workspace);
				execFileSync('tar', ['-xzf', archive, '-C', workspace], { timeout: 15000 });
				const packageRoot = join(workspace, 'package');
				const packedManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as typeof identity;
				expect(packedManifest.exports).toEqual(identity.exports);
				if (mutation === 'export-map') {
					packedManifest.exports['./standards']!.types = packedManifest.exports['./operator-contracts']!.types;
					writeFileSync(join(packageRoot, 'package.json'), JSON.stringify(packedManifest));
				} else writeFileSync(join(packageRoot, packedManifest.exports['./standards']!.types), 'export declare const incompatibleCandidate: never;\n');
				const changed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts'],
					{ cwd: packageRoot, encoding: 'utf8', timeout: 15000 })) as Array<{ filename: string }>;
				expect(changed).toHaveLength(1);
				const changedArchive = join(packageRoot, changed[0]!.filename);
				expect(readFileSync(changedArchive).equals(originalBytes)).toBe(false);
				const denied = inspect(changedArchive);
				expect(denied.status).toBe(1);
				expect(denied.stderr).toMatch(/candidate|declaration|export/iu);
				expect(readFileSync(archive)).toEqual(originalBytes);
			}
			expect(inspect(archive).status).toBe(0);
			expect(readFileSync(join(candidate, 'package.json'))).toEqual(manifestBytes);
			for (const { target, bytes } of sourceBytes) expect(readFileSync(join(candidate, target))).toEqual(bytes);
		} finally { rmSync(root, { recursive: true, force: true }); }
	}, 45000);
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
					// Independent package workspaces retain this candidate's actual
					// outputs; arbitrary placeholder declarations are not custody.
					writeFileSync(output, readFileSync(resolve(import.meta.dirname, '../../..', target)));
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
		const exports = { './entry': { default: './dist/entry.js', types: './dist/entry.d.ts' } }, before = structuredClone(exports);
		const outputs = new Map([['./dist/entry.js', Buffer.from('export const value = 1;\n')],
			['./dist/entry.d.ts', Buffer.from('export declare const value: number;\n')]]);
		const read = (target: string) => { const bytes = outputs.get(target); if (!bytes) throw new Error('Missing candidate output'); return bytes; };
		expect(() => assertPackageCandidateOutputs(exports, exports, read, read)).not.toThrow();
		expect(() => assertPackageCandidateOutputs({ './entry': { ...exports['./entry'], types: './dist/foreign.d.ts' } }, exports, read, read)).toThrow('export map');
		for (const target of outputs.keys()) expect(() => assertPackageCandidateOutputs(exports, exports,
			path => path === target ? Buffer.from('substituted') : read(path), read)).toThrow('candidate');
		expect(exports).toEqual(before);
	});
});
