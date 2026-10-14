import { expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, chmodSync, symlinkSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifySdkCommittedTests, verifySdkPublishedBranch } from '../../../acceptance/product/test-chain.ts';

it('native Git rejects unreviewed final integration trees and unrelated approved predecessors before unchanged retry', async () => {
	const root = mkdtempSync(join(tmpdir(), 'sdk-integration-chain-')), work = join(root, 'work'), repository = join(root, 'repository.git');
	const git = (args: string[]) => execFileSync('/usr/bin/git', ['-C', work, ...args], { encoding: 'utf8', timeout: 1000,
		env: { PATH: '/usr/bin:/bin', LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
	const commit = (message: string) => { git(['add', '.']); git(['-c', 'user.name=SDK native fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', message]); return git(['rev-parse', 'HEAD']); };
	const inspect: (repository: string, base: string, tester: string, engineer: string, integration: { writer: string; release: string; writerBase: string }) => unknown = verifySdkCommittedTests;
	try {
		mkdirSync(work); git(['init', '--template=']); mkdirSync(join(work, 'src')); mkdirSync(join(work, 'tests'));
		writeFileSync(join(work, 'src/product.ts'), 'export const original = true;\n');
		mkdirSync(join(work, 'docs')); writeFileSync(join(work, 'README.md'), 'Original user instructions.\n');
		writeFileSync(join(work, 'docs/guide.md'), '---\nrevision: 1\n---\nOriginal operator instructions.\n'); const base = commit('controlled BASE');
		writeFileSync(join(work, 'tests/intent.test.ts'), '// original approved test\n'); const tester = commit('controlled Tester');
		writeFileSync(join(work, 'src/product.ts'), 'export const original = false;\n'); const engineer = commit('controlled Engineer');
		writeFileSync(join(work, 'README.md'), 'Controlled reviewed Writer documentation.\n'); const writer = commit('controlled Writer');
		git(['clone', '--bare', '--no-local', work, repository]);
		const valid = { writer, release: writer, writerBase: engineer }; expect(() => inspect(repository, base, tester, engineer, valid)).not.toThrow();
		expect(() => inspect(repository, base, tester, engineer, { writer: engineer, release: engineer, writerBase: engineer })).toThrow('ACCEPTANCE_SDK_NATIVE_TEST_CHAIN');
		expect(() => inspect(repository, base, tester, engineer, { ...valid, writerBase: base })).toThrow('ACCEPTANCE_SDK_NATIVE_TEST_CHAIN');


		const deniedDocuments: string[] = [];
		for (const mode of ['empty', 'comment-only', 'frontmatter-only', 'source-only', 'non-doc-path', 'metadata-only', 'whitespace-only', 'redirected', 'deleted', 'binary', 'invalid-utf8', 'documentation-and-source']) {
			git(['checkout', '--detach', engineer]);
			if (mode === 'documentation-and-source') { writeFileSync(join(work, 'README.md'), 'Actual documentation with an unapproved product change.\n'); writeFileSync(join(work, 'src/product.ts'), 'export const original = true;\n'); }
			if (mode === 'empty') writeFileSync(join(work, 'README.md'), '');
			if (mode === 'comment-only') writeFileSync(join(work, 'README.md'), '<!-- no published instructions -->\n');
			if (mode === 'frontmatter-only') writeFileSync(join(work, 'README.md'), '---\nrevision: 2\n---\n');
			if (mode === 'source-only') writeFileSync(join(work, 'src/product.ts'), '// not documentation\n');
			if (mode === 'non-doc-path') writeFileSync(join(work, 'tests/observation.md'), 'A test observation is not user documentation.\n');
			if (mode === 'metadata-only') writeFileSync(join(work, 'docs/guide.md'), '---\nrevision: 2\n---\nOriginal operator instructions.\n');
			if (mode === 'whitespace-only') writeFileSync(join(work, 'README.md'), '\nOriginal user instructions.\n\n');
			if (mode === 'deleted' || mode === 'redirected') { rmSync(join(work, 'README.md')); if (mode === 'redirected') symlinkSync('src/product.ts', join(work, 'README.md')); }
			if (mode === 'binary') writeFileSync(join(work, 'README.md'), Buffer.from('instructions\0binary'));
			if (mode === 'invalid-utf8') writeFileSync(join(work, 'README.md'), Buffer.from([255]));
			const denied = commit(`controlled Writer ${mode}`); git(['--git-dir', repository, 'fetch', work, denied]);
			expect.soft(() => inspect(repository, base, tester, engineer, { writer: denied, release: denied, writerBase: engineer }), mode).toThrow('ACCEPTANCE_SDK_NATIVE_TEST_CHAIN'); deniedDocuments.push(denied);
		}
		git(['checkout', '--detach', engineer]); writeFileSync(join(work, 'docs/operator.md'), 'Use the exact approved implementation through its public client.\n');
		const newDocument = commit('controlled new operator documentation'); git(['--git-dir', repository, 'fetch', work, newDocument]);
		expect(() => inspect(repository, base, tester, engineer, { writer: newDocument, release: newDocument, writerBase: engineer })).not.toThrow();
		for (const retained of deniedDocuments) expect(git(['--git-dir', repository, 'rev-parse', `${retained}^{commit}`])).toBe(retained);

		const allowedDocumentUpdates: unknown[] = [];
		for (const mode of ['replace-obsolete', 'root-contributor']) {
			git(['checkout', '--detach', engineer]);
			if (mode === 'replace-obsolete') { rmSync(join(work, 'docs/guide.md')); writeFileSync(join(work, 'docs/current.md'), 'Use the current approved operator instructions.\n'); }
			else writeFileSync(join(work, 'AGENTS.md'), 'Contributors must use the reviewed public client and exact tests.\n');
			const actual = commit(`controlled legitimate documentation ${mode}`); git(['--git-dir', repository, 'fetch', work, actual]);
			try { inspect(repository, base, tester, engineer, { writer: actual, release: actual, writerBase: engineer }); allowedDocumentUpdates.push(undefined); }
			catch (error) { allowedDocumentUpdates.push(error instanceof Error ? error.message : String(error)); }
		}
		expect(allowedDocumentUpdates).toEqual([undefined, undefined]);
		git(['checkout', '--detach', writer]);
		writeFileSync(join(work, 'src/product.ts'), '// unreviewed release mutation\n'); const changed = commit('controlled unreviewed release');
		git(['--git-dir', repository, 'fetch', work, changed]);
		expect(() => inspect(repository, base, tester, engineer, { writer, release: changed, writerBase: engineer })).toThrow();
		expect(git(['--git-dir', repository, 'rev-parse', `${writer}^{tree}`])).not.toBe(git(['--git-dir', repository, 'rev-parse', `${changed}^{tree}`]));
		expect(() => inspect(repository, base, tester, engineer, { writer: base, release: writer, writerBase: engineer })).toThrow();
		expect(() => inspect(repository, base, tester, engineer, { writer, release: engineer, writerBase: engineer })).toThrow();
		expect(() => inspect(repository, base, tester, engineer, { writer, release: 'f'.repeat(40), writerBase: engineer })).toThrow();
		git(['checkout', '--detach', writer]); writeFileSync(join(work, 'tests/intent.test.ts'), '// substituted approved test\n');
		const substituted = commit('controlled substituted Writer tests'); git(['--git-dir', repository, 'fetch', work, substituted]);
		expect(() => inspect(repository, base, tester, engineer, { writer: substituted, release: substituted, writerBase: engineer })).toThrow();
		git(['checkout', '--detach', writer]); git(['-c', 'user.name=SDK native fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'controlled unchanged integration']);
		const release = git(['rev-parse', 'HEAD']); git(['--git-dir', repository, 'fetch', work, release]);
		const integrated = { writer, release, writerBase: engineer }; expect(() => inspect(repository, base, tester, engineer, integrated)).not.toThrow();
		const execute = promisify(execFile), worker = fileURLToPath(new URL('./test-chain-worker.ts', import.meta.url));
		const concurrent = await Promise.all(Array.from({ length: 3 }, () => execute(process.execPath,
			['--import', 'tsx', worker, repository, base, tester, engineer, '', JSON.stringify(integrated)], { timeout: 5000 })));
		expect(concurrent.every(value => JSON.parse(value.stdout).length === 1)).toBe(true);
		expect(() => inspect(repository, base, tester, engineer, valid)).not.toThrow();
	} finally { rmSync(root, { recursive: true, force: true }); }
});

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
		for (const mode of ['changed', 'deleted', 'symlink', 'mode', 'unrelated', 'package-script', 'runner-config', 'lock', 'runner-script', 'baseline-test', 'extra-test']) {
			git(['checkout', '--detach', engineer]);
			if (mode === 'unrelated') { git(['checkout', '--orphan', 'unrelated']); writeFileSync(join(work, 'unrelated.ts'), 'unrelated\n'); }
			else if (mode === 'package-script') writeFileSync(join(work, 'package.json'), JSON.stringify({ scripts: { 'test:contracts': 'echo false green' } }));
			else if (mode === 'runner-config') writeFileSync(join(work, 'vitest.contracts.config.ts'), 'export default { test: { include: [] } };\n');
			else if (mode === 'lock') writeFileSync(join(work, 'package-lock.json'), '{}\n');
			else if (mode === 'runner-script') { mkdirSync(join(work, 'scripts'), { recursive: true }); writeFileSync(join(work, 'scripts/test.ts'), '// substitute runner\n'); }
			else if (mode === 'baseline-test') writeFileSync(join(work, 'tests/baseline.test.ts'), '// replaced original baseline tests\n');
			else if (mode === 'extra-test') writeFileSync(join(work, 'tests/private.test.ts'), '// unapproved substitute tests\n');
			else if (mode === 'deleted') rmSync(join(work, path));
			else if (mode === 'symlink') { rmSync(join(work, path)); symlinkSync('../src/product.ts', join(work, path)); }
			else if (mode === 'mode') chmodSync(join(work, path), 0o755);
			else writeFileSync(join(work, path), Buffer.concat([bytes, Buffer.from('// substituted\n')]));
			const changed = commit(mode);
			git(['--git-dir', repository, 'fetch', work, changed]);
			expect.soft(() => verifySdkCommittedTests(repository, base, tester, changed), mode).toThrow(); denied.push(changed);
		}
		expect(denied).toHaveLength(11);
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
