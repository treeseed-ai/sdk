import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type SpawnOptions, type SpawnSyncOptions } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const packageCandidate = resolve(scriptRoot, '../..');

export const packageRoot = packageCandidate.endsWith('/dist')
	? resolve(packageCandidate, '..')
	: packageCandidate;
export const packageScriptRoot = packageCandidate.endsWith('/dist')
	? resolve(packageCandidate, 'scripts')
	: resolve(packageRoot, 'scripts');

function resolvePackageBinary(packageName: string, binName = packageName) {
	const packageJsonPath = require.resolve(`${packageName}/package.json`);
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	const binField = packageJson.bin;
	const relativePath =
		typeof binField === 'string'
			? binField
			: binField?.[binName];

	if (!relativePath) {
		throw new Error(`Unable to resolve binary "${binName}" from package "${packageName}".`);
	}

	return resolve(dirname(packageJsonPath), relativePath);
}

export function resolveAstroBin() {
	return resolvePackageBinary('astro', 'astro');
}

export function resolveWranglerBin() {
	return resolvePackageBinary('wrangler', 'wrangler');
}

export function createProductionBuildEnv(extraEnv: NodeJS.ProcessEnv = {}) {
	return {
		LOCAL_DEV_MODE: 'cloudflare',
		FORMS_LOCAL_BYPASS_CLOUDFLARE_GUARDS: '',
		TREESEED_PUBLIC_DEV_WATCH_RELOAD: '',
		...extraEnv,
	};
}

export function packageScriptPath(scriptName: string) {
	if (extname(scriptName)) {
		return resolve(packageScriptRoot, scriptName);
	}

	for (const extension of ['.ts', '.js']) {
		const candidate = resolve(packageScriptRoot, `${scriptName}${extension}`);
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(`Unable to resolve package script "${scriptName}".`);
}

export function runNodeBinary(binPath: string, args: string[], options: SpawnSyncOptions = {}) {
	const result = spawnSync(process.execPath, [binPath, ...args], {
		stdio: options.stdio ?? 'inherit',
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

export function runNodeScript(scriptPath: string, args: string[] = [], options: SpawnSyncOptions = {}) {
	if (scriptPath.endsWith('.ts')) {
		const result = spawnSync('tsx', [scriptPath, ...args], {
			stdio: options.stdio ?? 'inherit',
			cwd: options.cwd ?? process.cwd(),
			env: { ...process.env, ...(options.env ?? {}) },
		});
		if (result.status !== 0) {
			process.exit(result.status ?? 1);
		}
		return;
	}
	return runNodeBinary(scriptPath, args, options);
}

export function spawnNodeBinary(binPath: string, args: string[], options: SpawnOptions = {}) {
	return spawn(process.execPath, [binPath, ...args], {
		stdio: options.stdio ?? 'inherit',
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
		detached: options.detached ?? false,
	});
}
