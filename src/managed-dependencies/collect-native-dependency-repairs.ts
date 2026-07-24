import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, renameSync, chmodSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { platform as osPlatform, arch as osArch } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { withServiceCredentialEnv } from '../configuration/service-credentials.ts';
import { collectInstalledNativeDependencyIssues, esbuildPlatformPackage, npmBackedDependenciesAvailable, resolveNpmInstallCommand, resolveNpmToolRuntimeBinary } from './redact-sensitive-output.ts';
import { NPM_TOOLS } from './dependency-runtime.ts';
import type { DependencyInstallerOptions, NpmInstallReport } from './dependency-runtime.ts';

export function collectNativeDependencyRepairs(tenantRoot: string) {
	const binaryPackage = esbuildPlatformPackage();
	try {
		const lock = JSON.parse(readFileSync(resolve(tenantRoot, 'package-lock.json'), 'utf8')) as {
			packages?: Record<string, { version?: string; integrity?: string }>;
		};
		const packages = lock.packages ?? {};
		const repairs: Array<{ packagePath: string; packageName: string; version: string; integrity?: string; issue: string }> = [];
		for (const [packagePath, entry] of Object.entries(packages)) {
			if (!binaryPackage) break;
			if (packagePath !== 'node_modules/esbuild' && !packagePath.endsWith('/node_modules/esbuild')) continue;
			if (!existsSync(resolve(tenantRoot, packagePath, 'package.json'))) continue;
			const binaryPath = `${packagePath.slice(0, -'esbuild'.length)}${binaryPackage}`;
			const expectedBinary = packages[binaryPath];
			if (!expectedBinary?.version) continue;
			const installedBinaryPath = resolve(tenantRoot, binaryPath, 'package.json');
			if (!existsSync(installedBinaryPath)) {
				repairs.push({
					packagePath: binaryPath,
					packageName: binaryPackage,
					version: expectedBinary.version,
					integrity: expectedBinary.integrity,
					issue: `${binaryPath}: missing native binary ${expectedBinary.version} for ${packagePath}`,
				});
				continue;
			}
			const installedBinary = JSON.parse(readFileSync(installedBinaryPath, 'utf8')) as { version?: string };
			if (installedBinary.version !== expectedBinary.version || installedBinary.version !== entry.version) {
				repairs.push({
					packagePath: binaryPath,
					packageName: binaryPackage,
					version: expectedBinary.version,
					integrity: expectedBinary.integrity,
					issue: `${binaryPath}: native binary ${installedBinary.version ?? '(missing version)'} does not match host ${entry.version ?? '(missing version)'}`,
				});
			}
		}
		const codexPlatform = osPlatform() === 'linux' && osArch() === 'x64'
			? {
				// npm installs the platform artifact through an alias, but the
				// published package name remains @openai/codex. Packing the alias
				// name returns E404 and must never trigger a recursive workspace
				// install as a fallback.
				packageName: '@openai/codex',
				packagePath: 'node_modules/@openai/codex-linux-x64',
				binaryPath: 'vendor/x86_64-unknown-linux-musl/codex/codex',
			}
			: null;
		if (codexPlatform) {
			const locked = packages[codexPlatform.packagePath];
			const absoluteBinary = resolve(tenantRoot, codexPlatform.packagePath, codexPlatform.binaryPath);
			if (locked?.version && existsSync(resolve(tenantRoot, codexPlatform.packagePath, 'package.json'))) {
				const probe = existsSync(absoluteBinary)
					? spawnSync(absoluteBinary, ['--version'], { cwd: tenantRoot, stdio: 'pipe', encoding: 'utf8', timeout: 10_000 })
					: null;
				if (!probe || probe.status !== 0 || probe.error) {
					repairs.push({
						packagePath: codexPlatform.packagePath,
						packageName: codexPlatform.packageName,
						version: locked.version,
						integrity: locked.integrity,
						issue: `${codexPlatform.packagePath}: Codex native executable failed its --version integrity probe${probe?.status != null ? ` (exit ${probe.status})` : ''}`,
					});
				}
			}
		}
		return repairs;
	} catch {
		return [];
	}
}

export function resolveNpmPackCommand(env: NodeJS.ProcessEnv, spec: string, destination: string) {
	const args = ['pack', spec, '--json', '--ignore-scripts', '--pack-destination', destination];
	const npmExecPath = env.npm_execpath || env.NPM_EXEC_PATH;
	return npmExecPath?.trim()
		? { command: process.execPath, args: [npmExecPath, ...args] }
		: { command: 'npm', args };
}

export function repairInstalledNativeDependencies(
	tenantRoot: string,
	options: Required<Pick<DependencyInstallerOptions, 'env' | 'spawn'>> & Pick<DependencyInstallerOptions, 'write'>,
) {
	const repairs = collectNativeDependencyRepairs(tenantRoot);
	if (repairs.length === 0) return null;
	const tempParent = resolve(tenantRoot, '.treeseed', 'tmp');
	mkdirSync(tempParent, { recursive: true });
	const tempRoot = mkdtempSync(resolve(tempParent, 'native-dependency-'));
	try {
		for (const repair of repairs) {
			options.write?.(`Hydrating ${repair.packageName}@${repair.version} for ${repair.packagePath}.`);
			const pack = resolveNpmPackCommand(options.env, `${repair.packageName}@${repair.version}`, tempRoot);
			const packed = options.spawn(pack.command, pack.args, {
				cwd: tenantRoot,
				env: { ...options.env, TREESEED_MANAGED_NPM_INSTALL: '1' },
				stdio: 'pipe',
				encoding: 'utf8',
			});
			if (packed.status !== 0 || packed.error) return null;
			let metadata: Array<{ filename?: string; integrity?: string }>;
			try {
				metadata = JSON.parse(String(packed.stdout ?? '')) as Array<{ filename?: string; integrity?: string }>;
			} catch {
				return null;
			}
			const artifact = metadata[0];
			if (!artifact?.filename || (repair.integrity && artifact.integrity !== repair.integrity)) return null;
			const target = resolve(tenantRoot, repair.packagePath);
			rmSync(target, { recursive: true, force: true });
			mkdirSync(target, { recursive: true });
			const extracted = options.spawn('tar', ['-xzf', resolve(tempRoot, artifact.filename), '-C', target, '--strip-components=1'], {
				cwd: tenantRoot,
				env: options.env,
				stdio: 'pipe',
				encoding: 'utf8',
			});
			if (extracted.status !== 0 || extracted.error) return null;
		}
		return collectNativeDependencyRepairs(tenantRoot).length === 0 ? repairs.length : null;
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

export function resolveNpmRebuildCommand(env: NodeJS.ProcessEnv = process.env, packageNames: string[]) {
	const npmExecPath = env.npm_execpath || env.NPM_EXEC_PATH;
	if (npmExecPath?.trim()) {
		return {
			command: process.execPath,
			args: [npmExecPath, 'rebuild', ...packageNames],
			display: [process.execPath, npmExecPath, 'rebuild', ...packageNames],
		};
	}
	return {
		command: 'npm',
		args: ['rebuild', ...packageNames],
		display: ['npm', 'rebuild', ...packageNames],
	};
}

export function staleNpmGitClonePath(detail: string) {
	const match = /destination path '([^']+\/_cacache\/tmp\/git-clone[^/]+\/\.git)' already exists/u.exec(detail);
	if (!match?.[1]) return null;
	const gitPath = resolve(match[1]);
	const cloneRoot = dirname(gitPath);
	if (basename(gitPath) !== '.git' || !basename(cloneRoot).startsWith('git-clone')) return null;
	if (basename(dirname(cloneRoot)) !== 'tmp' || basename(dirname(dirname(cloneRoot))) !== '_cacache') return null;
	return cloneRoot;
}

export function runNpmBootstrap(options: Required<Pick<DependencyInstallerOptions, 'env' | 'spawn'>> & Pick<DependencyInstallerOptions, 'tenantRoot' | 'force' | 'write'>): NpmInstallReport[] {
	const tenantRoot = options.tenantRoot ? resolve(options.tenantRoot) : null;
	const npmCommand = resolveNpmInstallCommand(options.env);
	if (!tenantRoot || !existsSync(resolve(tenantRoot, 'package.json'))) {
		return [{
			root: tenantRoot,
			command: npmCommand.display,
			status: 'skipped',
			exitCode: null,
			detail: tenantRoot ? `No package.json found in ${tenantRoot}; npm install skipped.` : 'No tenant root was provided; npm install skipped.',
		}];
	}
	if (options.env.TREESEED_MANAGED_NPM_INSTALL === '1') {
		return [{
			root: tenantRoot,
			command: npmCommand.display,
			status: 'skipped',
			exitCode: null,
			detail: 'npm install skipped because TREESEED_MANAGED_NPM_INSTALL=1 is set.',
		}];
	}

	const nodeModulesMissing = !existsSync(resolve(tenantRoot, 'node_modules'));
	const npmDepsMissing = !npmBackedDependenciesAvailable();
	const missingRuntimeTools = npmToolsMissingRuntime();
	const nativeDependencyIssues = nodeModulesMissing ? [] : collectInstalledNativeDependencyIssues(tenantRoot);
	if (nativeDependencyIssues.length > 0) {
		const repaired = repairInstalledNativeDependencies(tenantRoot, options);
		if (repaired !== null) {
			return [{
				root: tenantRoot,
				command: ['npm', 'pack', '<lockfile-pinned-native-dependencies>'],
				status: 'installed',
				exitCode: 0,
				detail: `Hydrated ${repaired} lockfile-pinned native package artifact${repaired === 1 ? '' : 's'} without resolving the workspace dependency graph.`,
			}];
		}
		return [{
			root: tenantRoot,
			command: ['npm', 'pack', '<lockfile-pinned-native-dependencies>'],
			status: 'failed',
			exitCode: 1,
			detail: `Native dependency repair failed: ${nativeDependencyIssues.join('; ')}. The workspace dependency graph was not mutated. Re-run trsd install after confirming registry access and lockfile integrity.`,
		}];
	}
	if (!nodeModulesMissing && npmDepsMissing && missingRuntimeTools.length > 0) {
		return [{
			root: tenantRoot,
			command: npmCommand.display,
			status: 'already-present',
			exitCode: 0,
			detail: `npm dependencies are installed; rebuilding missing runtime tools: ${missingRuntimeTools.map((tool) => tool.packageName).join(', ')}.`,
		}];
	}
	if (!nodeModulesMissing && !npmDepsMissing && nativeDependencyIssues.length === 0) {
		return [{
			root: tenantRoot,
			command: npmCommand.display,
			status: 'already-present',
			exitCode: 0,
			detail: options.force
				? 'npm dependencies are already installed; force is limited to Treeseed-managed tool repair.'
				: 'npm dependencies are already installed.',
		}];
	}

	options.write?.(nativeDependencyIssues.length > 0
		? `Repairing npm dependency integrity in ${tenantRoot}: ${nativeDependencyIssues.join('; ')}`
		: `Installing npm dependencies in ${tenantRoot}...`);
	const testNpmInstallStatus = options.env.NODE_ENV === 'test' ? options.env.TREESEED_TEST_NPM_INSTALL_STATUS : undefined;
	if (testNpmInstallStatus === 'installed' || testNpmInstallStatus === 'failed') {
		const ok = testNpmInstallStatus === 'installed';
		return [{
			root: tenantRoot,
			command: npmCommand.display,
			status: ok ? 'installed' : 'failed',
			exitCode: ok ? 0 : 1,
			detail: ok
				? 'npm install completed successfully.'
				: 'npm install failed.',
		}];
	}
	const spawnInstall = () => options.spawn(npmCommand.command, npmCommand.args, {
		cwd: tenantRoot,
		env: {
			...options.env,
			TREESEED_MANAGED_NPM_INSTALL: '1',
		},
		stdio: 'pipe',
		encoding: 'utf8',
	});
	let result = spawnInstall();
	let detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim() || result.error?.message || '';
	const staleClone = result.status !== 0 ? staleNpmGitClonePath(detail) : null;
	if (staleClone) {
		options.write?.(`Removing interrupted npm Git clone ${staleClone} and retrying dependency repair once.`);
		rmSync(staleClone, { recursive: true, force: true });
		result = spawnInstall();
		detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim() || result.error?.message || '';
	}
	const ok = result.status === 0 && !result.error;
	return [{
		root: tenantRoot,
		command: npmCommand.display,
		status: ok ? 'installed' : 'failed',
		exitCode: result.status ?? 1,
		detail: ok
			? detail || 'npm install completed successfully.'
			: detail || 'npm install failed.',
	}];
}

export function npmToolsMissingRuntime() {
	return NPM_TOOLS.filter((tool) => !resolveNpmToolRuntimeBinary(tool));
}
