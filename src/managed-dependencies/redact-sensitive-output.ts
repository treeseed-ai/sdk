import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, renameSync, chmodSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { platform as osPlatform, arch as osArch } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { withServiceCredentialEnv } from '../configuration/service-credentials.ts';
import { NPM_PACKAGES, NPM_TOOLS, cleanCommandPathOutput, require } from './dependency-runtime.ts';
import type { ManagedToolName } from './dependency-runtime.ts';
import { collectNativeDependencyRepairs } from './collect-native-dependency-repairs.ts';

export function redactSensitiveOutput(output: string) {
	return output
		.replace(/^(\s*-\s*Token:\s*).+$/gim, '$1***')
		.replace(/\b(?:github_pat|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_*.-]+/gu, '***');
}

export function locateSystemBinary(command: string, spawn = spawnSync, env: NodeJS.ProcessEnv = process.env) {
	if (process.platform === 'win32') {
		return null;
	}
	const result = spawn('bash', ['-lc', `command -v ${command}`], {
		stdio: 'pipe',
		encoding: 'utf8',
		env,
	});
	return result.status === 0 ? cleanCommandPathOutput(String(result.stdout ?? '')) : null;
}

export function checkCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; spawn?: typeof spawnSync } = {}) {
	const run = options.spawn ?? spawnSync;
	const result = run(command, args, {
		cwd: options.cwd,
		env: options.env,
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: 15000,
	});
	return {
		ok: result.status === 0,
		status: result.status ?? 1,
		stdout: String(result.stdout ?? '').trim(),
		stderr: String(result.stderr ?? '').trim(),
		detail: `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim() || result.error?.message || '',
	};
}

export function resolvePackageJsonPath(packageName: string) {
	try {
		const packageJsonPath = require.resolve(`${packageName}/package.json`);
		if (existsSync(packageJsonPath)) {
			return packageJsonPath;
		}
	} catch {
		// Fall through to explicit path search below.
	}
	for (const searchPath of require.resolve.paths(packageName) ?? []) {
		const candidate = resolve(searchPath, packageName, 'package.json');
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(`Unable to resolve package manifest for "${packageName}".`);
}

export function resolvePackageJsonPathOptional(packageName: string) {
	try {
		return resolvePackageJsonPath(packageName);
	} catch {
		return null;
	}
}

export function resolvePackageBinary(packageName: string, binName: string) {
	const packageJsonPath = resolvePackageJsonPath(packageName);
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { bin?: string | Record<string, string> };
	const relativeBin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[binName];
	if (!relativeBin) {
		throw new Error(`Unable to resolve binary "${binName}" from package "${packageName}".`);
	}
	const resolvedBin = resolve(dirname(packageJsonPath), relativeBin);
	if (existsSync(resolvedBin) || !relativeBin.startsWith('../')) {
		return resolvedBin;
	}
	const packageLocalFallback = resolve(dirname(packageJsonPath), relativeBin.replace(/^\.\.\//u, ''));
	return existsSync(packageLocalFallback) ? packageLocalFallback : resolvedBin;
}

export function resolvePackageBinaryOptional(packageName: string, binName: string) {
	const packageJsonPath = resolvePackageJsonPathOptional(packageName);
	if (!packageJsonPath) {
		return null;
	}
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { bin?: string | Record<string, string> };
		const relativeBin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[binName];
		if (!relativeBin) {
			return null;
		}
		const resolvedBin = resolve(dirname(packageJsonPath), relativeBin);
		if (existsSync(resolvedBin) || !relativeBin.startsWith('../')) {
			return resolvedBin;
		}
		const packageLocalFallback = resolve(dirname(packageJsonPath), relativeBin.replace(/^\.\.\//u, ''));
		return existsSync(packageLocalFallback) ? packageLocalFallback : resolvedBin;
	} catch {
		return null;
	}
}

export function resolvePackageRoot(packageName: string) {
	return dirname(resolvePackageJsonPath(packageName));
}

export function findNpmTool(name: ManagedToolName) {
	return NPM_TOOLS.find((tool) => tool.name === name) ?? null;
}

export function resolveNpmToolRuntimeBinary(tool: (typeof NPM_TOOLS)[number]) {
	const packageJsonPath = resolvePackageJsonPathOptional(tool.packageName);
	if (!packageJsonPath) {
		return null;
	}
	const packageRoot = dirname(packageJsonPath);
	const packageBin = resolvePackageBinaryOptional(tool.packageName, tool.binName);
	if (!packageBin || !existsSync(packageBin)) {
		return null;
	}
	if (!tool.runtimeBinary) {
		return packageBin;
	}
	const runtimeBinary = tool.runtimeBinary(packageRoot);
	return existsSync(runtimeBinary) ? runtimeBinary : null;
}

export function npmToolMissingDetail(tool: (typeof NPM_TOOLS)[number]) {
	const packageJsonPath = resolvePackageJsonPathOptional(tool.packageName);
	if (!packageJsonPath) {
		return `${tool.packageName} is missing from the installed package graph.`;
	}
	const packageRoot = dirname(packageJsonPath);
	const packageBin = resolvePackageBinaryOptional(tool.packageName, tool.binName);
	if (!packageBin || !existsSync(packageBin)) {
		return `${tool.packageName} binary ${tool.binName} is missing from the installed package.`;
	}
	if (tool.runtimeBinary) {
		const runtimeBinary = tool.runtimeBinary(packageRoot);
		if (!existsSync(runtimeBinary)) {
			return `${tool.packageName} runtime binary ${runtimeBinary} is missing. Run \`npx trsd install --json\` or npm install without --ignore-scripts.`;
		}
	}
	return `${tool.packageName} is unavailable.`;
}

export function npmBackedDependenciesAvailable() {
	try {
		for (const tool of NPM_TOOLS) {
			const binaryPath = resolveNpmToolRuntimeBinary(tool);
			if (!binaryPath || !existsSync(binaryPath)) {
				return false;
			}
		}
		for (const pkg of NPM_PACKAGES) {
			const packageRoot = resolvePackageRoot(pkg.packageName);
			if (!existsSync(packageRoot)) {
				return false;
			}
		}
		return true;
	} catch {
		return false;
	}
}

export function resolveNpmInstallCommand(env: NodeJS.ProcessEnv = process.env) {
	const installArgs = ['install', '--ignore-scripts', '--prefer-offline', '--workspaces=false', '--no-audit', '--no-fund'];
	const npmCommandOverride = env.TREESEED_NPM_INSTALL_COMMAND;
	if (npmCommandOverride?.trim()) {
		return {
			command: npmCommandOverride,
			args: installArgs,
			display: [npmCommandOverride, ...installArgs],
		};
	}
	const npmExecPath = env.npm_execpath || env.NPM_EXEC_PATH;
	if (npmExecPath?.trim()) {
		return {
			command: process.execPath,
			args: [npmExecPath, ...installArgs],
			display: [process.execPath, npmExecPath, ...installArgs],
		};
	}
	return {
		command: 'npm',
		args: installArgs,
		display: ['npm', ...installArgs],
	};
}

export function esbuildPlatformPackage() {
	const platform = osPlatform();
	const arch = osArch();
	if (platform === 'linux' && ['x64', 'arm64', 'arm', 'ia32', 'ppc64', 'riscv64', 's390x'].includes(arch)) return `@esbuild/linux-${arch}`;
	if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return `@esbuild/darwin-${arch}`;
	if (platform === 'win32' && ['x64', 'arm64', 'ia32'].includes(arch)) return `@esbuild/win32-${arch}`;
	return null;
}

export function collectInstalledNativeDependencyIssues(tenantRoot: string) {
	return collectNativeDependencyRepairs(tenantRoot).map((repair) => repair.issue);
}
