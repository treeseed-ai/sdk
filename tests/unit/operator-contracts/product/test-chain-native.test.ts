import { expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, chmodSync, symlinkSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifySdkCommittedTests, verifySdkPublishedBranch } from '../../../acceptance/product/test-chain.ts';

it('native Git proves test-only approved ancestry and identical consumed blobs while retaining changed deleted redirected and unrelated failures before exact retry', async () => {
	const root = mkdtempSync(join(tmpdir(), 'sdk-test-chain-')), work = join(root, 'work'), repository = join(root, 'repository.git');
	const git = (args: string[]) => execFileSync('/usr/bin/git', ['-C', work, ...args], { encoding: 'utf8', timeout: 1000,
		env: { PATH: '/usr/bin:/bin', LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
	const commit = (message: string) => { git(['add', '.']); git(['-c', 'user.name=SDK native fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', message]); return git(['rev-parse', 'HEAD']); };
	try {
		mkdirSync(work); git(['init', '--template=']); mkdirSync(join(work, 'src')); writeFileSync(join(work, 'src/product.ts'), 'export const original = true;\n');
		mkdirSync(join(work, 'tests')); writeFileSync(join(work, 'tests/baseline.test.ts'), '// retained baseline tests\n');
		const base = commit('controlled BASE');
		const path = 'tests/intent.test.ts', bytes = Buffer.from("// controlled approved fixture\nexport const expected = 'exact';\n\n");
		writeFileSync(join(work, path), bytes); const tester = commit('controlled test-only candidate');
		writeFileSync(join(work, 'src/product.ts'), 'export const original = false;\n'); const engineer = commit('controlled descendant implementation');
		git(['clone', '--bare', '--no-local', work, repository]);
		const published = { kind: 'git' as const, repository: 'treeseed-ai/sdk', commit: tester, branch: 'simulation/original-tester' };
		const branchRef = `refs/heads/${published.branch}`;
		git(['--git-dir', repository, 'update-ref', branchRef, tester]);
		expect(verifySdkPublishedBranch(repository, published)).toBe(tester);
		for (const branch of ['', 'missing', '../outside', 'bad..branch', 'bad.lock', 'bad\nbranch']) {
			expect(() => verifySdkPublishedBranch(repository, { ...published, branch })).toThrow();
		}
		git(['--git-dir', repository, 'update-ref', branchRef, engineer]);
		expect(() => verifySdkPublishedBranch(repository, published)).toThrow();
		git(['--git-dir', repository, 'update-ref', '-d', branchRef]);
		expect(() => verifySdkPublishedBranch(repository, published)).toThrow();
		expect(git(['--git-dir', repository, 'rev-parse', '--verify', `${tester}^{commit}`])).toBe(tester);
		git(['--git-dir', repository, 'update-ref', branchRef, tester]);
		expect(verifySdkPublishedBranch(repository, published)).toBe(tester);
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
		expect(denied).toHaveLength(5);
		const independentlyDenied: string[] = [documentationOnly];
		for (const mode of ['empty', 'fixture-only', 'source', 'deleted-test', 'redirected-test', 'non-test-path']) {
			git(['checkout', '--detach', mode === 'source' || mode === 'non-test-path' ? tester : base]);
			if (mode === 'fixture-only') writeFileSync(join(work, 'tests/fixture.ts'), '// helper only\n');
			if (mode === 'source') writeFileSync(join(work, 'src/product.ts'), '// premature implementation\n');
			if (mode === 'non-test-path') writeFileSync(join(work, 'README.md'), '// non-test change\n');
			if (mode === 'deleted-test' || mode === 'redirected-test') {
				rmSync(join(work, 'tests/baseline.test.ts'));
				if (mode === 'redirected-test') symlinkSync('../src/product.ts', join(work, 'tests/baseline.test.ts'));
				writeFileSync(join(work, path), bytes);
			}
			const badTester = mode === 'empty' ? (git(['-c', 'user.name=SDK native fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', mode]), git(['rev-parse', 'HEAD'])) : commit(mode);
			writeFileSync(join(work, 'src/product.ts'), `// later actual implementation ${mode}\n`); const next = commit('later implementation');
			git(['--git-dir', repository, 'fetch', work, next]);
			expect(() => verifySdkCommittedTests(repository, base, badTester, next)).toThrow(); independentlyDenied.push(badTester, next);
		}
		for (const mode of ['deleted-source', 'redirected-source']) {
			git(['checkout', '--detach', tester]); rmSync(join(work, 'src/product.ts'));
			if (mode === 'redirected-source') symlinkSync('../tests/baseline.test.ts', join(work, 'src/product.ts'));
			const next = commit(mode); git(['--git-dir', repository, 'fetch', work, next]);
			expect(() => verifySdkCommittedTests(repository, base, tester, next)).toThrow(); independentlyDenied.push(next);
		}
		git(['checkout', '--detach', engineer]);
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
			const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', worker, repository, base, tester, engineer, JSON.stringify(published)], { timeout: 5000 });
			return JSON.parse(result.stdout) as unknown;
		}));
		expect(retries).toEqual(Array.from({ length: 4 }, () => proof)); expect(readFileSync(join(work, path))).toEqual(bytes);
		for (const failed of [...denied, ...independentlyDenied]) expect(git(['--git-dir', repository, 'rev-parse', '--verify', `${failed}^{commit}`])).toBe(failed);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
