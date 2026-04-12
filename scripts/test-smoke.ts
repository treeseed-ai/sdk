import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageRoot } from './package-tools.ts';

const npmCacheDir = resolve(tmpdir(), 'treeseed-npm-cache');

function run(command: string, args: string[], cwd = packageRoot, capture = false, extraEnv: NodeJS.ProcessEnv = {}) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
		env: {
			...process.env,
			...extraEnv,
			npm_config_cache: npmCacheDir,
			NPM_CONFIG_CACHE: npmCacheDir,
		},
	});

	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} ${args.join(' ')} failed`);
	}

	return (result.stdout ?? '').trim();
}

function resolveNodeModulesRoot() {
	let current = packageRoot;
	while (true) {
		const candidate = resolve(current, 'node_modules');
		try {
			readdirSync(candidate);
			return candidate;
		} catch {
		}

		const parent = resolve(current, '..');
		if (parent === current) break;
		current = parent;
	}

	throw new Error(`Unable to locate node_modules for ${packageRoot}.`);
}

function mirrorDependencies(tempRoot: string) {
	const sharedNodeModules = resolveNodeModulesRoot();
	for (const entry of readdirSync(sharedNodeModules, { withFileTypes: true })) {
		if (entry.name === '.bin') {
			continue;
		}

		if (entry.name === '@treeseed') {
			const sourceScopeRoot = resolve(sharedNodeModules, entry.name);
			const targetScopeRoot = resolve(tempRoot, 'node_modules', entry.name);
			mkdirSync(targetScopeRoot, { recursive: true });
			for (const scopedEntry of readdirSync(sourceScopeRoot, { withFileTypes: true })) {
				if (scopedEntry.name === 'sdk') {
					continue;
				}

				const targetPath = resolve(targetScopeRoot, scopedEntry.name);
				symlinkSync(resolve(sourceScopeRoot, scopedEntry.name), targetPath, scopedEntry.isDirectory() ? 'dir' : 'file');
			}
			continue;
		}

		const targetPath = resolve(tempRoot, 'node_modules', entry.name);
		mkdirSync(dirname(targetPath), { recursive: true });
		symlinkSync(resolve(sharedNodeModules, entry.name), targetPath, 'dir');
	}
}

function resolveInstalledSdkRoot(installRoot: string) {
	const directRoot = resolve(installRoot, 'node_modules', '@treeseed', 'sdk');
	const nestedRoot = resolve(directRoot, 'package');
	if (existsSync(resolve(directRoot, 'package.json'))) {
		return directRoot;
	}
	if (existsSync(resolve(nestedRoot, 'package.json'))) {
		return nestedRoot;
	}
	throw new Error('Unable to locate installed SDK package root in smoke test.');
}

function loadPackedSdkPackageJson(installRoot: string) {
	return JSON.parse(readFileSync(resolve(resolveInstalledSdkRoot(installRoot), 'package.json'), 'utf8')) as {
		bin?: Record<string, string>;
	};
}

function wireSdkBin(installRoot: string) {
	const packageJson = loadPackedSdkPackageJson(installRoot);
	const relativeBinPath = packageJson.bin?.['treeseed-sdk-verify'];
	if (!relativeBinPath) {
		throw new Error('Packed SDK is missing treeseed-sdk-verify bin metadata.');
	}

	const binRoot = resolve(installRoot, 'node_modules', '.bin');
	const target = resolve(resolveInstalledSdkRoot(installRoot), relativeBinPath);
	const linkPath = resolve(binRoot, 'treeseed-sdk-verify');

	mkdirSync(binRoot, { recursive: true });
	symlinkSync(target, linkPath);
	chmodSync(target, 0o755);

	return linkPath;
}

const stageRoot = mkdtempSync(join(tmpdir(), 'treeseed-sdk-smoke-'));
const packRoot = resolve(stageRoot, 'pack');
const extractRoot = resolve(stageRoot, 'extract');
const installRoot = resolve(stageRoot, 'install');

try {
	mkdirSync(packRoot, { recursive: true });
	mkdirSync(extractRoot, { recursive: true });
	const packOutput = run('npm', ['pack', '--ignore-scripts', '--cache', npmCacheDir, '--pack-destination', packRoot], packageRoot, true);
	const filename = packOutput
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1)
		?? readdirSync(packRoot, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith('.tgz'))
			.map((entry) => entry.name)
			.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
			.at(-1);

	if (!filename) {
		throw new Error('Unable to determine packed SDK tarball name.');
	}

	const tarballPath = resolve(packRoot, filename);
	run('tar', ['-xzf', tarballPath, '-C', extractRoot]);
	mkdirSync(resolve(installRoot, 'node_modules', '@treeseed'), { recursive: true });
	run('cp', ['-R', resolve(extractRoot, 'package'), resolve(installRoot, 'node_modules', '@treeseed', 'sdk')]);
	mirrorDependencies(installRoot);
	const verifyBin = wireSdkBin(installRoot);
	writeFileSync(resolve(installRoot, 'package.json'), `${JSON.stringify({
		name: 'treeseed-sdk-smoke',
		private: true,
		type: 'module',
		scripts: {
			'verify:direct': 'node --input-type=module -e "console.log(\'treeseed-sdk-smoke-verify\')"',
			'verify:local': 'node --input-type=module -e "process.env.TREESEED_VERIFY_DRIVER=\'direct\'; console.log(\'treeseed-sdk-smoke-verify-local\')"',
			'verify:action': 'node --input-type=module -e "process.env.TREESEED_VERIFY_DRIVER=\'act\'; console.log(\'treeseed-sdk-smoke-verify-action\')"',
		},
	}, null, 2)}\n`, 'utf8');
	run(process.execPath, ['--input-type=module', '-e', 'await import("@treeseed/sdk/verification");'], installRoot);
	run(verifyBin, [], installRoot, false, { TREESEED_VERIFY_DRIVER: 'direct' });
	console.log('SDK packed-install smoke passed.');
} finally {
	rmSync(stageRoot, { recursive: true, force: true });
}
