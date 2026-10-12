import { expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, chmodSync, symlinkSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifySdkCommittedTests } from '../../../acceptance/product/test-chain.ts';

it('native Git proves test-only approved ancestry and identical consumed blobs while retaining changed deleted redirected and unrelated failures before exact retry', async () => {
	const root = mkdtempSync(join(tmpdir(), 'sdk-test-chain-')), work = join(root, 'work'), repository = join(root, 'repository.git');
	const git = (args: string[]) => execFileSync('/usr/bin/git', ['-C', work, ...args], { encoding: 'utf8', timeout: 1000,
		env: { PATH: '/usr/bin:/bin', LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
	const commit = (message: string) => { git(['add', '.']); git(['-c', 'user.name=SDK native fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', message]); return git(['rev-parse', 'HEAD']); };
	try {
		mkdirSync(work); git(['init', '--template=']); mkdirSync(join(work, 'src')); writeFileSync(join(work, 'src/product.ts'), 'export const original = true;\n');
		const base = commit('controlled BASE'); mkdirSync(join(work, 'tests'));
		const path = 'tests/intent.test.ts', bytes = Buffer.from("// controlled approved fixture\nexport const expected = 'exact';\n\n");
		writeFileSync(join(work, path), bytes); const tester = commit('controlled test-only candidate');
		writeFileSync(join(work, 'src/product.ts'), 'export const original = false;\n'); const engineer = commit('controlled descendant implementation');
		git(['clone', '--bare', '--no-local', work, repository]);
		const proof = verifySdkCommittedTests(repository, base, tester, engineer);
		expect(proof).toHaveLength(1); expect(proof[0]!.path).toBe(path);
		expect(readFileSync(join(work, path))).toEqual(bytes);
		git(['checkout', '--detach', tester]); writeFileSync(join(work, 'README.md'), 'Documentation only; no implementation.\n');
		const documentationOnly = commit('controlled missing implementation'); git(['--git-dir', repository, 'fetch', work, documentationOnly]);
		expect(() => verifySdkCommittedTests(repository, base, tester, documentationOnly)).toThrow();
		const denied: string[] = [];
		for (const mode of ['changed', 'deleted', 'symlink', 'mode', 'unrelated']) {
			git(['checkout', '--detach', engineer]);
			if (mode === 'unrelated') { git(['checkout', '--orphan', 'unrelated']); writeFileSync(join(work, 'unrelated.ts'), 'unrelated\n'); }
			else if (mode === 'deleted') rmSync(join(work, path));
			else if (mode === 'symlink') { rmSync(join(work, path)); symlinkSync('../src/product.ts', join(work, path)); }
			else if (mode === 'mode') chmodSync(join(work, path), 0o755);
			else writeFileSync(join(work, path), Buffer.concat([bytes, Buffer.from('// substituted\n')]));
			const changed = commit(mode);
			git(['--git-dir', repository, 'fetch', work, changed]);
			expect(() => verifySdkCommittedTests(repository, base, tester, changed)).toThrow(); denied.push(changed);
		}
		expect(denied).toHaveLength(5); git(['checkout', '--detach', engineer]);
		for (const invalid of ['--unsafe', '', 'a'.repeat(39), 'f'.repeat(40), base]) expect(() => verifySdkCommittedTests(repository, base, tester, invalid)).toThrow();
		expect(() => verifySdkCommittedTests(repository, tester, engineer, engineer)).toThrow();
		writeFileSync(join(repository, 'shallow'), `${base}\n`);
		expect(() => verifySdkCommittedTests(repository, base, tester, engineer)).toThrow(); rmSync(join(repository, 'shallow'));
		expect(() => verifySdkCommittedTests(repository, base, engineer, denied[0]!)).toThrow();
		const outside = join(root, 'redirect.git'); symlinkSync(repository, outside);
		expect(() => verifySdkCommittedTests(outside, base, tester, engineer)).toThrow();
		writeFileSync(join(repository, 'objects/info/alternates'), '/tmp/foreign\n');
		expect(() => verifySdkCommittedTests(repository, base, tester, engineer)).toThrow(); rmSync(join(repository, 'objects/info/alternates'));
		const worker = fileURLToPath(new URL('./test-chain-worker.ts', import.meta.url));
		const retries = await Promise.all(Array.from({ length: 4 }, async () => {
			const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', worker, repository, base, tester, engineer], { timeout: 5000 });
			return JSON.parse(result.stdout) as unknown;
		}));
		expect(retries).toEqual(Array.from({ length: 4 }, () => proof)); expect(readFileSync(join(work, path))).toEqual(bytes);
		for (const failed of denied) expect(git(['--git-dir', repository, 'rev-parse', '--verify', `${failed}^{commit}`])).toBe(failed);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
