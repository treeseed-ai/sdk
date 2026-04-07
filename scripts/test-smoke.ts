import { mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageRoot } from './package-tools.ts';

function run(command: string, args: string[], cwd = packageRoot, capture = false) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
		env: process.env,
	});

	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} ${args.join(' ')} failed`);
	}

	return (result.stdout ?? '').trim();
}

function resolveNodeModulesRoot() {
	let lastCandidate: string | null = null;
	let current = packageRoot;
	while (true) {
		const candidate = resolve(current, 'node_modules');
		try {
			readdirSync(candidate);
			lastCandidate = candidate;
		} catch {
		}

		const parent = resolve(current, '..');
		if (parent === current) break;
		current = parent;
	}

	if (lastCandidate) {
		return lastCandidate;
	}

	throw new Error(`Unable to locate node_modules for ${packageRoot}.`);
}

function mirrorDependencies(tempRoot: string) {
	const sharedNodeModules = resolveNodeModulesRoot();
	for (const entry of readdirSync(sharedNodeModules, { withFileTypes: true })) {
		if (entry.name === '.bin' || entry.name === '@treeseed') {
			continue;
		}

		const targetPath = resolve(tempRoot, 'node_modules', entry.name);
		mkdirSync(dirname(targetPath), { recursive: true });
		symlinkSync(resolve(sharedNodeModules, entry.name), targetPath, 'dir');
	}
}

const stageRoot = mkdtempSync(join(tmpdir(), 'treeseed-sdk-smoke-'));
const packRoot = resolve(stageRoot, 'pack');
const extractRoot = resolve(stageRoot, 'extract');
const installRoot = resolve(stageRoot, 'install');

try {
	mkdirSync(packRoot, { recursive: true });
	mkdirSync(extractRoot, { recursive: true });
	const filename = run('npm', ['pack', '--silent', '--ignore-scripts', '--pack-destination', packRoot], packageRoot, true)
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);

	if (!filename) {
		throw new Error('Unable to determine packed SDK tarball name.');
	}

	const tarballPath = resolve(packRoot, filename);
	run('tar', ['-xzf', tarballPath, '-C', extractRoot]);
	mkdirSync(resolve(installRoot, 'node_modules', '@treeseed'), { recursive: true });
	run('cp', ['-R', resolve(extractRoot, 'package'), resolve(installRoot, 'node_modules', '@treeseed', 'sdk')]);
	mirrorDependencies(installRoot);
	writeFileSync(resolve(installRoot, 'package.json'), `${JSON.stringify({ name: 'treeseed-sdk-smoke', private: true, type: 'module' }, null, 2)}\n`, 'utf8');
	run(process.execPath, ['--input-type=module', '-e', 'await import("@treeseed/sdk");'], installRoot);
	console.log('SDK packed-install smoke passed.');
} finally {
	rmSync(stageRoot, { recursive: true, force: true });
}
