import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { canonicalStandardsJson } from '../../src/standards/index.ts';

function argument(name: string) {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : null;
	if (!value) throw new Error(`Missing required ${name} argument.`);
	return value;
}

const repository = argument('--repository');
const sourceCommit = argument('--source-commit');
if (!/^https:\/\/github\.com\/treeseed-ai\/api(?:\.git)?$/u.test(repository)) throw new Error('The initial SDK consumer proof is restricted to the public treeseed-ai/api repository.');
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('API consumer source commit must be a full Git SHA.');
const root = resolve(import.meta.dirname, '../..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { name: string; version: string };
const tarball = resolve(root, `.treeseed/standards/package/treeseed-sdk-${packageJson.version}.tgz`);
const packageDigest = `sha256:${createHash('sha256').update(readFileSync(tarball)).digest('hex')}`;
const worktree = mkdtempSync(join(tmpdir(), 'treeseed-sdk-api-consumer-'));
try {
	execFileSync('git', ['clone', '--quiet', '--no-checkout', repository, worktree], { stdio: 'inherit' });
	execFileSync('git', ['checkout', '--quiet', '--detach', sourceCommit], { cwd: worktree, stdio: 'inherit' });
	const observed = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).trim();
	if (observed !== sourceCommit) throw new Error(`API consumer checkout resolved ${observed}, expected ${sourceCommit}.`);
	execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', tarball], { cwd: worktree, stdio: 'inherit' });
	execFileSync('npm', ['run', 'build'], { cwd: worktree, stdio: 'inherit' });
	execFileSync('npx', [
		'vitest', 'run', '--config', './vitest.config.ts',
		'tests/contract/api/provider-assignment-capability-handles.test.ts',
		'tests/contract/api/api-route-descriptors.test.ts',
		'tests/unit/governance/content-validation.test.ts',
	], { cwd: worktree, stdio: 'inherit' });
	const receipt = {
		schemaVersion: 1,
		consumerRepository: 'treeseed-ai/api',
		consumerSourceCommit: sourceCommit,
		candidatePackage: packageJson.name,
		candidateVersion: packageJson.version,
		candidateArtifactDigest: packageDigest,
		build: 'passed',
		testFiles: 3,
		tests: 20,
		consumerCommits: 0,
	};
	const outputPath = resolve(root, '.treeseed/standards/api-consumer-receipt.json');
	writeFileSync(outputPath, `${canonicalStandardsJson(receipt)}\n`);
	console.log(JSON.stringify({ ok: true, ...receipt, outputPath }));
} finally {
	rmSync(worktree, { recursive: true, force: true });
}
