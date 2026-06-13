import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { loadTreeseedDeployConfigFromPath } from '../../platform/deploy-config.ts';

const require = createRequire(import.meta.url);
const scriptRoot = dirname(fileURLToPath(import.meta.url));
function resolveSdkPackageRoot(startDir: string) {
	let currentDir = startDir;
	while (true) {
		const packageJsonPath = resolve(currentDir, 'package.json');
		if (existsSync(packageJsonPath)) {
			try {
				const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
				if (packageJson?.name === '@treeseed/sdk') {
					return currentDir;
				}
			} catch {
				// Ignore unreadable package manifests while walking upward.
			}
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			return resolve(startDir, '..', '..', '..');
		}
		currentDir = parentDir;
	}
}

const packageRootFromSource = resolveSdkPackageRoot(scriptRoot);
const treeseedRuntimeRoot = resolve(packageRootFromSource, 'src', 'treeseed');
const TRESEED_WORKSPACE_PACKAGE_DIRS = ['sdk', 'core', 'cli'];

export const packageRoot = packageRootFromSource;
export const packageScriptRoot = resolve(packageRoot, 'scripts');
export const packageDistScriptRoot = resolve(packageRoot, 'dist', 'scripts');
export const runtimeRoot = treeseedRuntimeRoot;

function resolvePackageBinary(packageName, binName = packageName) {
	const packageJsonPath = require.resolve(`${packageName}/package.json`);
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	const binField = packageJson.bin;
	const relativePath = typeof binField === 'string' ? binField : binField?.[binName];

	if (!relativePath) {
		throw new Error(`Unable to resolve binary "${binName}" from package "${packageName}".`);
	}

	return resolve(dirname(packageJsonPath), relativePath);
}

export function treeseedWorkspacePackageCheckoutState(root = resolve(packageRoot, '..')) {
	const packages = TRESEED_WORKSPACE_PACKAGE_DIRS.map((dirName) => {
		const dir = resolve(root, dirName);
		return {
			dirName,
			dir,
			present: existsSync(resolve(dir, 'package.json')),
		};
	});
	const present = packages.filter((entry) => entry.present);
	return {
		mode: present.length === 0
			? 'registry'
			: present.length === packages.length
				? 'workspace'
				: 'partial',
		packages,
		missing: packages.filter((entry) => !entry.present),
	};
}

function assertUsableTreeseedPackageCheckout(fallbackDirName?: string) {
	if (!fallbackDirName) {
		return;
	}
	const state = treeseedWorkspacePackageCheckoutState();
	const rootHasTreeseedSubmodules = existsSync(resolve(packageRoot, '..', '..', '.gitmodules'));
	if (state.mode !== 'partial' || !rootHasTreeseedSubmodules) {
		return;
	}
	const missing = state.missing.map((entry) => `packages/${entry.dirName}`).join(', ');
	throw new Error(
		`Partial Treeseed package checkout detected. Missing package manifests: ${missing}. `
		+ 'Run `git submodule update --init --recursive` to use workspace mode, or remove the partial checkout to use registry mode.',
	);
}

function resolveTreeseedPackageRoot(packageName, exportPath?: string, fallbackDirName?: string) {
	assertUsableTreeseedPackageCheckout(fallbackDirName);
	if (fallbackDirName) {
		const localRoot = resolve(packageRoot, '..', fallbackDirName);
		if (existsSync(resolve(localRoot, 'package.json'))) {
			return localRoot;
		}
	}

	try {
		const resolvedEntry = require.resolve(exportPath ?? packageName);
		if ((exportPath ?? packageName).endsWith('/package.json')) {
			return dirname(resolvedEntry);
		}
		return resolve(dirname(resolvedEntry), '..');
	} catch {
		if (!fallbackDirName) {
			throw new Error(`Unable to resolve package root for "${packageName}".`);
		}
		return resolve(packageRoot, '..', fallbackDirName);
	}
}

export function resolveAstroBin() {
	return resolvePackageBinary('astro', 'astro');
}

export function resolveWranglerBin() {
	return resolvePackageBinary('wrangler', 'wrangler');
}
export const corePackageRoot = resolveTreeseedPackageRoot('@treeseed/core', '@treeseed/core/config', 'core');
export const agentPackageRoot = resolveTreeseedPackageRoot('@treeseed/agent', '@treeseed/agent', 'agent');
export const sdkPackageRoot = resolveTreeseedPackageRoot('@treeseed/sdk', '@treeseed/sdk', 'sdk');

export function loadPackageJson(root = process.cwd()) {
	const packageJsonPath = resolve(root, 'package.json');
	if (!existsSync(packageJsonPath)) {
		return null;
	}
	return JSON.parse(readFileSync(packageJsonPath, 'utf8'));
}

export function isWorkspaceRoot(root = process.cwd()) {
	const packageJson = loadPackageJson(root);
	const workspaces = Array.isArray(packageJson?.workspaces)
		? packageJson.workspaces
		: Array.isArray(packageJson?.workspaces?.packages)
			? packageJson.workspaces.packages
			: [];
	return workspaces.length > 0;
}

export function createProductionBuildEnv(extraEnv = {}) {
	return {
		TREESEED_LOCAL_DEV_MODE: 'cloudflare',
		TREESEED_FORMS_LOCAL_BYPASS_CLOUDFLARE_GUARDS: '',
		TREESEED_PUBLIC_DEV_WATCH_RELOAD: '',
		...extraEnv,
	};
}

export function packageScriptPath(scriptName) {
	if (extname(scriptName)) {
		const directScriptPath = resolve(packageScriptRoot, scriptName);
		if (existsSync(directScriptPath)) {
			return directScriptPath;
		}

		const distScriptPath = resolve(packageDistScriptRoot, scriptName.replace(/\.(ts|mjs)$/u, '.js'));
		if (existsSync(distScriptPath)) {
			return distScriptPath;
		}

		return directScriptPath;
	}

	for (const extension of ['.js', '.ts', '.mjs']) {
		const candidate = resolve(packageScriptRoot, `${scriptName}${extension}`);
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	for (const extension of ['.js', '.mjs']) {
		const candidate = resolve(packageDistScriptRoot, `${scriptName}${extension}`);
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(`Unable to resolve package script "${scriptName}".`);
}

export function withProcessCwd(cwd, action) {
	const previous = process.cwd();
	if (previous === cwd) {
		return action();
	}

	process.chdir(cwd);
	try {
		return action();
	} finally {
		process.chdir(previous);
	}
}

export function loadCliDeployConfig(tenantRoot) {
	const configPath = resolve(tenantRoot, 'treeseed.site.yaml');
	if (!existsSync(configPath)) {
		throw new Error(`Unable to resolve Treeseed deploy config at "${configPath}".`);
	}

	return loadTreeseedDeployConfigFromPath(configPath);
}

export function runNodeBinary(binPath, args, options = {}) {
	const result = spawnSync(process.execPath, [binPath, ...args], {
		stdio: options.stdio ?? 'inherit',
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

export function runNodeScript(scriptPath, args = [], options = {}) {
	return runNodeBinary(scriptPath, args, options);
}

export function spawnNodeBinary(binPath, args, options = {}) {
	return spawn(process.execPath, [binPath, ...args], {
		stdio: options.stdio ?? 'inherit',
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...(options.env ?? {}) },
		detached: options.detached ?? false,
	});
}
