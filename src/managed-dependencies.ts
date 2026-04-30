import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, renameSync, chmodSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { homedir, platform as osPlatform, arch as osArch } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type TreeseedManagedToolName =
	| 'git'
	| 'gh'
	| 'wrangler'
	| 'railway'
	| 'copilot'
	| 'copilot-sdk'
	| 'copilot-language-server'
	| 'docker'
	| 'gh-act';

export type TreeseedManagedDependencyStatus =
	| 'already-present'
	| 'installed'
	| 'repaired'
	| 'skipped'
	| 'missing'
	| 'failed'
	| 'unsupported';

export type TreeseedDependencyReport = {
	name: TreeseedManagedToolName;
	kind: 'system' | 'download' | 'npm' | 'extension';
	version?: string;
	source: 'system' | 'managed-cache' | 'package' | 'managed-gh-config' | 'not-applicable';
	binaryPath: string | null;
	status: TreeseedManagedDependencyStatus;
	required: boolean;
	detail: string;
};

export type TreeseedNpmInstallReport = {
	root: string | null;
	command: string[];
	status: 'already-present' | 'installed' | 'skipped' | 'failed';
	exitCode: number | null;
	detail: string;
};

export type TreeseedDependencyInstallResult = {
	ok: boolean;
	toolsHome: string;
	ghConfigDir: string;
	npmInstalls: TreeseedNpmInstallReport[];
	reports: TreeseedDependencyReport[];
};

type DependencyInstallerOptions = {
	tenantRoot?: string;
	force?: boolean;
	env?: NodeJS.ProcessEnv;
	write?: (line: string) => void;
	downloadFile?: (url: string, targetPath: string) => Promise<void>;
	spawn?: typeof spawnSync;
};

type PlatformAsset = {
	platform: 'linux' | 'darwin';
	arch: 'x64' | 'arm64';
	assetName: string;
	archiveKind: 'tar.gz' | 'zip';
};

const GH_VERSION = '2.90.0';
const GH_CHECKSUMS_SHA256 = '95cbb66008dc467cf402724025f07551d2a949b3cc830146206a2797b963966c';
const GH_RELEASE_BASE_URL = `https://github.com/cli/cli/releases/download/v${GH_VERSION}`;
const GH_ASSETS: PlatformAsset[] = [
	{ platform: 'linux', arch: 'x64', assetName: `gh_${GH_VERSION}_linux_amd64.tar.gz`, archiveKind: 'tar.gz' },
	{ platform: 'linux', arch: 'arm64', assetName: `gh_${GH_VERSION}_linux_arm64.tar.gz`, archiveKind: 'tar.gz' },
	{ platform: 'darwin', arch: 'x64', assetName: `gh_${GH_VERSION}_macOS_amd64.zip`, archiveKind: 'zip' },
	{ platform: 'darwin', arch: 'arm64', assetName: `gh_${GH_VERSION}_macOS_arm64.zip`, archiveKind: 'zip' },
];

const NPM_TOOLS: Array<{
	name: Extract<TreeseedManagedToolName, 'wrangler' | 'railway' | 'copilot' | 'copilot-language-server'>;
	packageName: string;
	binName: string;
	version: string;
}> = [
	{ name: 'wrangler', packageName: 'wrangler', binName: 'wrangler', version: '4.86.0' },
	{ name: 'railway', packageName: '@railway/cli', binName: 'railway', version: '4.44.0' },
	{ name: 'copilot', packageName: '@github/copilot', binName: 'copilot', version: '1.0.39' },
	{ name: 'copilot-language-server', packageName: '@github/copilot-language-server', binName: 'copilot-language-server', version: '1.480.0' },
];

const NPM_PACKAGES: Array<{
	name: Extract<TreeseedManagedToolName, 'copilot-sdk'>;
	packageName: string;
	version: string;
}> = [
	{ name: 'copilot-sdk', packageName: '@github/copilot-sdk', version: '0.3.0' },
];

function report(input: Omit<TreeseedDependencyReport, 'binaryPath'> & { binaryPath?: string | null }): TreeseedDependencyReport {
	return {
		binaryPath: input.binaryPath ?? null,
		...input,
	};
}

function sha256File(filePath: string) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function resolveToolsHome(env: NodeJS.ProcessEnv = process.env) {
	if (env.TREESEED_TOOLS_HOME?.trim()) {
		return resolve(env.TREESEED_TOOLS_HOME);
	}
	if (env.XDG_CACHE_HOME?.trim()) {
		return resolve(env.XDG_CACHE_HOME, 'treeseed', 'tools');
	}
	return resolve(homedir(), '.cache', 'treeseed', 'tools');
}

export function createTreeseedManagedToolEnv(env: NodeJS.ProcessEnv = process.env) {
	const toolsHome = resolveToolsHome(env);
	const ghBinDir = resolve(toolsHome, 'gh', GH_VERSION, platformKey(), 'bin');
	const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
	const existingPath = env[pathKey] ?? env.PATH ?? '';
	return {
		...env,
		GH_CONFIG_DIR: env.TREESEED_GH_CONFIG_DIR ?? resolve(toolsHome, 'gh-config'),
		GH_PROMPT_DISABLED: '1',
		GH_NO_UPDATE_NOTIFIER: '1',
		[pathKey]: [ghBinDir, existingPath].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
	};
}

function platformKey(platform = osPlatform(), arch = osArch()) {
	return `${platform}-${arch}`;
}

function currentPlatformAsset(): PlatformAsset | null {
	const platform = osPlatform();
	const arch = osArch();
	if (platform !== 'linux' && platform !== 'darwin') {
		return null;
	}
	if (arch !== 'x64' && arch !== 'arm64') {
		return null;
	}
	return GH_ASSETS.find((asset) => asset.platform === platform && asset.arch === arch) ?? null;
}

function managedGhBin(env: NodeJS.ProcessEnv = process.env) {
	return resolve(resolveToolsHome(env), 'gh', GH_VERSION, platformKey(), 'bin', 'gh');
}

function locateSystemBinary(command: string, spawn = spawnSync, env: NodeJS.ProcessEnv = process.env) {
	if (process.platform === 'win32') {
		return null;
	}
	const result = spawn('bash', ['-lc', `command -v ${command}`], {
		stdio: 'pipe',
		encoding: 'utf8',
		env,
	});
	return result.status === 0 ? String(result.stdout ?? '').trim() || null : null;
}

function checkCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; spawn?: typeof spawnSync } = {}) {
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

function resolvePackageJsonPath(packageName: string) {
	try {
		return require.resolve(`${packageName}/package.json`);
	} catch {
		for (const searchPath of require.resolve.paths(packageName) ?? []) {
			const candidate = resolve(searchPath, packageName, 'package.json');
			if (existsSync(candidate)) {
				return candidate;
			}
		}
		throw new Error(`Unable to resolve package manifest for "${packageName}".`);
	}
}

function resolvePackageBinary(packageName: string, binName: string) {
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

function resolvePackageRoot(packageName: string) {
	return dirname(resolvePackageJsonPath(packageName));
}

function findNpmTool(name: TreeseedManagedToolName) {
	return NPM_TOOLS.find((tool) => tool.name === name) ?? null;
}

function npmBackedDependenciesAvailable() {
	try {
		for (const tool of NPM_TOOLS) {
			const binaryPath = resolvePackageBinary(tool.packageName, tool.binName);
			if (!existsSync(binaryPath)) {
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

function resolveNpmInstallCommand(env: NodeJS.ProcessEnv = process.env) {
	const npmCommandOverride = env.TREESEED_NPM_INSTALL_COMMAND;
	if (npmCommandOverride?.trim()) {
		return {
			command: npmCommandOverride,
			args: ['install', '--no-audit', '--no-fund'],
			display: [npmCommandOverride, 'install', '--no-audit', '--no-fund'],
		};
	}
	const npmExecPath = env.npm_execpath || env.NPM_EXEC_PATH;
	if (npmExecPath?.trim()) {
		return {
			command: process.execPath,
			args: [npmExecPath, 'install', '--no-audit', '--no-fund'],
			display: [process.execPath, npmExecPath, 'install', '--no-audit', '--no-fund'],
		};
	}
	return {
		command: 'npm',
		args: ['install', '--no-audit', '--no-fund'],
		display: ['npm', 'install', '--no-audit', '--no-fund'],
	};
}

function runNpmBootstrap(options: Required<Pick<DependencyInstallerOptions, 'env' | 'spawn'>> & Pick<DependencyInstallerOptions, 'tenantRoot' | 'force' | 'write'>): TreeseedNpmInstallReport[] {
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
	if (!options.force && !nodeModulesMissing && !npmDepsMissing) {
		return [{
			root: tenantRoot,
			command: npmCommand.display,
			status: 'already-present',
			exitCode: 0,
			detail: 'npm dependencies are already installed.',
		}];
	}

	options.write?.(`Installing npm dependencies in ${tenantRoot}...`);
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
	const result = options.spawn(npmCommand.command, npmCommand.args, {
		cwd: tenantRoot,
		env: {
			...options.env,
			TREESEED_MANAGED_NPM_INSTALL: '1',
		},
		stdio: 'pipe',
		encoding: 'utf8',
	});
	const detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim() || result.error?.message || '';
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

export function formatTreeseedDependencyFailureDetails(result: Pick<TreeseedDependencyInstallResult, 'npmInstalls' | 'reports'>) {
	const npmFailures = result.npmInstalls
		.filter((entry) => entry.status === 'failed')
		.map((entry) => {
			const root = entry.root ?? 'no tenant root';
			const exit = entry.exitCode === null ? 'unknown exit code' : `exit code ${entry.exitCode}`;
			return `npm install in ${root}: ${entry.command.join(' ')} failed with ${exit}${entry.detail ? `: ${entry.detail}` : ''}`;
		});
	const toolFailures = result.reports
		.filter((entry) => entry.required && ['failed', 'missing', 'unsupported'].includes(entry.status))
		.map((entry) => `${entry.name}: ${entry.detail}`);
	return [...npmFailures, ...toolFailures].join('\n- ') || 'No dependency failure details were reported.';
}

export function resolveTreeseedToolBinary(toolName: TreeseedManagedToolName, options: { env?: NodeJS.ProcessEnv } = {}) {
	if (toolName === 'gh') {
		const managed = managedGhBin(options.env);
		if (existsSync(managed)) {
			return managed;
		}
		return locateSystemBinary('gh', spawnSync, options.env ?? process.env);
	}
	const npmTool = findNpmTool(toolName);
	if (npmTool) {
		return resolvePackageBinary(npmTool.packageName, npmTool.binName);
	}
	if (toolName === 'git' || toolName === 'docker') {
		return locateSystemBinary(toolName, spawnSync, options.env ?? process.env);
	}
	return null;
}

export function resolveTreeseedToolCommand(toolName: TreeseedManagedToolName, options: { env?: NodeJS.ProcessEnv } = {}) {
	const binaryPath = resolveTreeseedToolBinary(toolName, options);
	if (!binaryPath) {
		return null;
	}
	if (findNpmTool(toolName)) {
		return { command: process.execPath, argsPrefix: [binaryPath], binaryPath };
	}
	return { command: binaryPath, argsPrefix: [], binaryPath };
}

async function defaultDownloadFile(url: string, targetPath: string): Promise<void> {
	const request = url.startsWith('https:') ? httpsRequest : httpRequest;
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const req = request(url, (response) => {
			const status = response.statusCode ?? 0;
			const location = response.headers.location;
			if (status >= 300 && status < 400 && location) {
				response.resume();
				defaultDownloadFile(new URL(location, url).toString(), targetPath).then(resolvePromise, rejectPromise);
				return;
			}
			if (status < 200 || status >= 300) {
				response.resume();
				rejectPromise(new Error(`Download failed (${status}) for ${url}`));
				return;
			}
			mkdirSync(dirname(targetPath), { recursive: true });
			const output = createWriteStream(targetPath);
			response.pipe(output);
			output.on('finish', () => {
				output.close();
				resolvePromise();
			});
			output.on('error', rejectPromise);
		});
		req.on('error', rejectPromise);
		req.end();
	});
}

function parseChecksums(contents: string, assetName: string) {
	for (const line of contents.split(/\r?\n/u)) {
		const [hash, name] = line.trim().split(/\s+/u);
		if (name === assetName && /^[a-f0-9]{64}$/iu.test(hash ?? '')) {
			return hash.toLowerCase();
		}
	}
	return null;
}

function findExtractedGhBinary(root: string): string | null {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = resolve(root, entry.name);
		if (entry.isDirectory()) {
			const found = findExtractedGhBinary(fullPath);
			if (found) return found;
			continue;
		}
		if (entry.isFile() && basename(fullPath) === 'gh' && basename(dirname(fullPath)) === 'bin') {
			return fullPath;
		}
	}
	return null;
}

async function installGh(options: Required<Pick<DependencyInstallerOptions, 'env' | 'downloadFile' | 'spawn'>> & Pick<DependencyInstallerOptions, 'tenantRoot' | 'force' | 'write'>): Promise<TreeseedDependencyReport> {
	const asset = currentPlatformAsset();
	if (!asset) {
		return report({
			name: 'gh',
			kind: 'download',
			version: GH_VERSION,
			source: 'not-applicable',
			status: 'unsupported',
			required: true,
			detail: 'Managed GitHub CLI installation supports Linux and macOS on x64 or arm64.',
		});
	}

	const binaryPath = managedGhBin(options.env);
	if (existsSync(binaryPath)) {
		const check = checkCommand(binaryPath, ['--version'], {
			cwd: options.tenantRoot,
			env: createTreeseedManagedToolEnv(options.env),
			spawn: options.spawn,
		});
		if (check.ok && check.stdout.includes(GH_VERSION)) {
			return report({
				name: 'gh',
				kind: 'download',
				version: GH_VERSION,
				source: 'managed-cache',
				binaryPath,
				status: options.force ? 'repaired' : 'already-present',
				required: true,
				detail: check.stdout.split('\n')[0] ?? `GitHub CLI ${GH_VERSION} is installed.`,
			});
		}
	}

	const toolsHome = resolveToolsHome(options.env);
	const tmpRoot = resolve(toolsHome, '.tmp', `gh-${process.pid}-${Date.now()}`);
	const archivePath = resolve(tmpRoot, asset.assetName);
	const checksumsPath = resolve(tmpRoot, `gh_${GH_VERSION}_checksums.txt`);
	const extractRoot = resolve(tmpRoot, 'extract');
	const installRoot = dirname(dirname(binaryPath));
	const stagingRoot = `${installRoot}.staging-${process.pid}-${Date.now()}`;
	try {
		options.write?.(`Installing GitHub CLI ${GH_VERSION}...`);
		rmSync(tmpRoot, { recursive: true, force: true });
		mkdirSync(extractRoot, { recursive: true });
		await options.downloadFile(`${GH_RELEASE_BASE_URL}/gh_${GH_VERSION}_checksums.txt`, checksumsPath);
		const checksumsHash = sha256File(checksumsPath);
		if (checksumsHash !== GH_CHECKSUMS_SHA256) {
			throw new Error(`GitHub CLI checksums file hash mismatch: expected ${GH_CHECKSUMS_SHA256}, got ${checksumsHash}.`);
		}
		const expectedAssetHash = parseChecksums(readFileSync(checksumsPath, 'utf8'), asset.assetName);
		if (!expectedAssetHash) {
			throw new Error(`GitHub CLI checksums file does not contain ${asset.assetName}.`);
		}
		await options.downloadFile(`${GH_RELEASE_BASE_URL}/${asset.assetName}`, archivePath);
		const assetHash = sha256File(archivePath);
		if (assetHash !== expectedAssetHash) {
			throw new Error(`GitHub CLI archive hash mismatch for ${asset.assetName}: expected ${expectedAssetHash}, got ${assetHash}.`);
		}
		if (asset.archiveKind === 'zip') {
			const { default: extractZip } = await import('extract-zip');
			await extractZip(archivePath, { dir: extractRoot });
		} else {
			const tar = await import('tar');
			await tar.x({ file: archivePath, cwd: extractRoot });
		}
		const extractedBinary = findExtractedGhBinary(extractRoot);
		if (!extractedBinary) {
			throw new Error(`Unable to find gh binary in ${asset.assetName}.`);
		}
		rmSync(stagingRoot, { recursive: true, force: true });
		mkdirSync(resolve(stagingRoot, 'bin'), { recursive: true });
		copyFileSync(extractedBinary, resolve(stagingRoot, 'bin', 'gh'));
		chmodSync(resolve(stagingRoot, 'bin', 'gh'), 0o755);
		rmSync(installRoot, { recursive: true, force: true });
		mkdirSync(dirname(installRoot), { recursive: true });
		renameSync(stagingRoot, installRoot);
		const check = checkCommand(binaryPath, ['--version'], {
			cwd: options.tenantRoot,
			env: createTreeseedManagedToolEnv(options.env),
			spawn: options.spawn,
		});
		if (!check.ok) {
			throw new Error(check.detail || 'GitHub CLI failed after installation.');
		}
		return report({
			name: 'gh',
			kind: 'download',
			version: GH_VERSION,
			source: 'managed-cache',
			binaryPath,
			status: existsSync(binaryPath) && options.force ? 'repaired' : 'installed',
			required: true,
			detail: check.stdout.split('\n')[0] ?? `GitHub CLI ${GH_VERSION} installed.`,
		});
	} catch (error) {
		return report({
			name: 'gh',
			kind: 'download',
			version: GH_VERSION,
			source: 'managed-cache',
			binaryPath,
			status: 'failed',
			required: true,
			detail: error instanceof Error ? error.message : String(error),
		});
	} finally {
		rmSync(tmpRoot, { recursive: true, force: true });
		rmSync(stagingRoot, { recursive: true, force: true });
	}
}

function statusForNpmTool(tool: (typeof NPM_TOOLS)[number], options: DependencyInstallerOptions): TreeseedDependencyReport {
	try {
		const binaryPath = resolvePackageBinary(tool.packageName, tool.binName);
		return report({
			name: tool.name,
			kind: 'npm',
			version: tool.version,
			source: 'package',
			binaryPath,
			status: existsSync(binaryPath) ? 'already-present' : 'missing',
			required: true,
			detail: existsSync(binaryPath)
				? `${tool.packageName} is available from the Treeseed SDK dependency graph.`
				: `${tool.packageName} binary ${tool.binName} is missing from the installed package.`,
		});
	} catch (error) {
		return report({
			name: tool.name,
			kind: 'npm',
			version: tool.version,
			source: 'package',
			status: 'failed',
			required: true,
			detail: error instanceof Error ? error.message : String(error),
		});
	}
}

function statusForNpmPackage(pkg: (typeof NPM_PACKAGES)[number]): TreeseedDependencyReport {
	try {
		const packageRoot = resolvePackageRoot(pkg.packageName);
		return report({
			name: pkg.name,
			kind: 'npm',
			version: pkg.version,
			source: 'package',
			binaryPath: null,
			status: existsSync(packageRoot) ? 'already-present' : 'missing',
			required: true,
			detail: existsSync(packageRoot)
				? `${pkg.packageName} is available from the Treeseed SDK dependency graph at ${packageRoot}.`
				: `${pkg.packageName} is missing from the installed package graph.`,
		});
	} catch (error) {
		return report({
			name: pkg.name,
			kind: 'npm',
			version: pkg.version,
			source: 'package',
			status: 'failed',
			required: true,
			detail: error instanceof Error ? error.message : String(error),
		});
	}
}

function systemStatus(name: 'git' | 'docker', required: boolean, options: DependencyInstallerOptions): TreeseedDependencyReport {
	const binaryPath = locateSystemBinary(name, options.spawn ?? spawnSync, options.env ?? process.env);
	return report({
		name,
		kind: 'system',
		source: binaryPath ? 'system' : 'not-applicable',
		binaryPath,
		status: binaryPath ? 'already-present' : required ? 'missing' : 'skipped',
		required,
		detail: binaryPath
			? `${name} detected at ${binaryPath}.`
			: required ? `${name} is required and was not found on PATH.` : `${name} was not found on PATH.`,
	});
}

function installGhAct(options: DependencyInstallerOptions): TreeseedDependencyReport {
	const env = createTreeseedManagedToolEnv(options.env ?? process.env);
	const gh = resolveTreeseedToolBinary('gh', { env });
	const docker = locateSystemBinary('docker', options.spawn ?? spawnSync, options.env ?? process.env);
	if (!docker) {
		return report({
			name: 'gh-act',
			kind: 'extension',
			version: 'nektos/gh-act',
			source: 'managed-gh-config',
			status: 'skipped',
			required: false,
			detail: 'Docker is not on PATH, so gh-act installation was skipped.',
		});
	}
	if (!gh) {
		return report({
			name: 'gh-act',
			kind: 'extension',
			version: 'nektos/gh-act',
			source: 'managed-gh-config',
			status: 'failed',
			required: false,
			detail: 'GitHub CLI is unavailable, so gh-act cannot be installed.',
		});
	}
	const existing = checkCommand(gh, ['act', '--version'], {
		cwd: options.tenantRoot,
		env,
		spawn: options.spawn,
	});
	if (existing.ok && !options.force) {
		return report({
			name: 'gh-act',
			kind: 'extension',
			version: 'nektos/gh-act',
			source: 'managed-gh-config',
			binaryPath: gh,
			status: 'already-present',
			required: false,
			detail: existing.stdout.split('\n')[0] ?? 'gh-act is installed.',
		});
	}
	options.write?.('Installing GitHub CLI extension gh-act...');
	const install = checkCommand(gh, ['extension', 'install', 'https://github.com/nektos/gh-act', ...(options.force ? ['--force'] : [])], {
		cwd: options.tenantRoot,
		env,
		spawn: options.spawn,
	});
	const postInstall = checkCommand(gh, ['act', '--version'], {
		cwd: options.tenantRoot,
		env,
		spawn: options.spawn,
	});
	return report({
		name: 'gh-act',
		kind: 'extension',
		version: 'nektos/gh-act',
		source: 'managed-gh-config',
		binaryPath: gh,
		status: postInstall.ok ? (existing.ok ? 'repaired' : 'installed') : 'failed',
		required: false,
		detail: postInstall.ok
			? postInstall.stdout.split('\n')[0] ?? 'gh-act is installed.'
			: install.detail || postInstall.detail || 'Unable to install gh-act.',
	});
}

export async function installTreeseedDependencies(options: DependencyInstallerOptions = {}): Promise<TreeseedDependencyInstallResult> {
	const env = options.env ?? process.env;
	const effectiveOptions = {
		...options,
		env,
		downloadFile: options.downloadFile ?? defaultDownloadFile,
		spawn: options.spawn ?? spawnSync,
	};
	mkdirSync(resolveToolsHome(env), { recursive: true });
	mkdirSync(createTreeseedManagedToolEnv(env).GH_CONFIG_DIR, { recursive: true });
	const npmInstalls = runNpmBootstrap(effectiveOptions);
	const reports: TreeseedDependencyReport[] = [
		systemStatus('git', true, effectiveOptions),
		await installGh(effectiveOptions),
		...NPM_TOOLS.map((tool) => statusForNpmTool(tool, effectiveOptions)),
		...NPM_PACKAGES.map((pkg) => statusForNpmPackage(pkg)),
		systemStatus('docker', false, effectiveOptions),
		installGhAct(effectiveOptions),
	];
	const ok =
		npmInstalls.every((entry) => entry.status !== 'failed') &&
		reports.every((entry) => !entry.required || !['failed', 'missing', 'unsupported'].includes(entry.status));
	return {
		ok,
		toolsHome: resolveToolsHome(env),
		ghConfigDir: createTreeseedManagedToolEnv(env).GH_CONFIG_DIR,
		npmInstalls,
		reports,
	};
}

export function collectTreeseedDependencyStatus(options: DependencyInstallerOptions = {}): TreeseedDependencyInstallResult {
	const env = options.env ?? process.env;
	const ghBinary = managedGhBin(env);
	const ghStatus = existsSync(ghBinary)
		? report({
			name: 'gh',
			kind: 'download',
			version: GH_VERSION,
			source: 'managed-cache',
			binaryPath: ghBinary,
			status: 'already-present',
			required: true,
			detail: `GitHub CLI ${GH_VERSION} is installed in the Treeseed tool cache.`,
		})
		: report({
			name: 'gh',
			kind: 'download',
			version: GH_VERSION,
			source: 'managed-cache',
			binaryPath: ghBinary,
			status: 'missing',
			required: true,
			detail: `GitHub CLI ${GH_VERSION} is not installed in the Treeseed tool cache.`,
		});
	const reports = [
		systemStatus('git', true, options),
		ghStatus,
		...NPM_TOOLS.map((tool) => statusForNpmTool(tool, options)),
		...NPM_PACKAGES.map((pkg) => statusForNpmPackage(pkg)),
		systemStatus('docker', false, options),
		report({
			name: 'gh-act',
			kind: 'extension',
			version: 'nektos/gh-act',
			source: 'managed-gh-config',
			binaryPath: ghBinary,
			status: existsSync(ghBinary) ? 'already-present' : 'skipped',
			required: false,
			detail: existsSync(ghBinary)
				? 'gh-act status is checked during installation because it requires executing gh.'
				: 'gh-act is skipped until GitHub CLI is installed.',
		}),
	] satisfies TreeseedDependencyReport[];
	return {
		ok: reports.every((entry) => !entry.required || !['failed', 'missing', 'unsupported'].includes(entry.status)),
		toolsHome: resolveToolsHome(env),
		ghConfigDir: createTreeseedManagedToolEnv(env).GH_CONFIG_DIR,
		npmInstalls: [],
		reports,
	};
}

export function formatTreeseedDependencyReport(result: TreeseedDependencyInstallResult) {
	return [
		'Treeseed dependency status',
		`Tools home: ${result.toolsHome}`,
		`GitHub CLI config: ${result.ghConfigDir}`,
		...result.npmInstalls.map((entry) => {
			const root = entry.root ? ` in ${entry.root}` : '';
			const command = entry.command.length > 0 ? ` (${entry.command.join(' ')})` : '';
			return `- npm install${root}: ${entry.status} - ${entry.detail}${command}`;
		}),
		...result.reports.map((entry) => {
			const path = entry.binaryPath ? ` (${entry.binaryPath})` : '';
			return `- ${entry.name}: ${entry.status} - ${entry.detail}${path}`;
		}),
	].join('\n');
}
