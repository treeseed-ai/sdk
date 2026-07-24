import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, renameSync, chmodSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { platform as osPlatform, arch as osArch } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { withServiceCredentialEnv } from '../configuration/service-credentials.ts';


export const require = createRequire(import.meta.url);

export type ManagedToolName =
	| 'git'
	| 'gh'
	| 'wrangler'
	| 'railway'
	| 'copilot'
	| 'copilot-sdk'
	| 'copilot-language-server'
	| 'docker'
	| 'gh-act';

export type ManagedDependencyStatus =
	| 'already-present'
	| 'installed'
	| 'repaired'
	| 'skipped'
	| 'missing'
	| 'failed'
	| 'unsupported';

export type DependencyReport = {
	name: ManagedToolName;
	kind: 'system' | 'download' | 'npm' | 'extension';
	version?: string;
	source: 'system' | 'managed-cache' | 'package' | 'managed-gh-config' | 'not-applicable';
	binaryPath: string | null;
	status: ManagedDependencyStatus;
	required: boolean;
	detail: string;
};

export type NpmInstallReport = {
	root: string | null;
	command: string[];
	status: 'already-present' | 'installed' | 'skipped' | 'failed';
	exitCode: number | null;
	detail: string;
};

export type DependencyInstallResult = {
	ok: boolean;
	toolsHome: string;
	ghConfigDir: string;
	npmInstalls: NpmInstallReport[];
	reports: DependencyReport[];
};

export type ToolInvocation = {
	mode: 'direct' | 'node' | 'unavailable';
	command: string | null;
	argsPrefix: string[];
	binaryPath: string | null;
};

export type ToolReport = DependencyReport & {
	invocation: ToolInvocation;
};

export type ToolStatusResult = DependencyInstallResult & {
	tools: ToolReport[];
	auth: {
		github: {
			checked: boolean;
			authenticated: boolean;
			binaryPath: string | null;
			command: string[];
			detail: string;
			remediation: string[];
		};
	};
};

export type DependencyInstallerOptions = {
	tenantRoot?: string;
	force?: boolean;
	env?: NodeJS.ProcessEnv;
	write?: (line: string) => void;
	downloadFile?: (url: string, targetPath: string) => Promise<void>;
	spawn?: typeof spawnSync;
};

export type PlatformAsset = {
	platform: 'linux' | 'darwin';
	arch: 'x64' | 'arm64';
	assetName: string;
	archiveKind: 'tar.gz' | 'zip';
};

export type VerifiedPlatformAsset = PlatformAsset & {
	sha256: string;
};

export const GH_VERSION = '2.90.0';

export const GH_CHECKSUMS_SHA256 = '95cbb66008dc467cf402724025f07551d2a949b3cc830146206a2797b963966c';

export const GH_RELEASE_BASE_URL = `https://github.com/cli/cli/releases/download/v${GH_VERSION}`;

export const GH_ASSETS: PlatformAsset[] = [
	{ platform: 'linux', arch: 'x64', assetName: `gh_${GH_VERSION}_linux_amd64.tar.gz`, archiveKind: 'tar.gz' },
	{ platform: 'linux', arch: 'arm64', assetName: `gh_${GH_VERSION}_linux_arm64.tar.gz`, archiveKind: 'tar.gz' },
	{ platform: 'darwin', arch: 'x64', assetName: `gh_${GH_VERSION}_macOS_amd64.zip`, archiveKind: 'zip' },
	{ platform: 'darwin', arch: 'arm64', assetName: `gh_${GH_VERSION}_macOS_arm64.zip`, archiveKind: 'zip' },
];

export const RAILWAY_VERSION = '5.23.2';

export const RAILWAY_RELEASE_BASE_URL = `https://github.com/railwayapp/cli/releases/download/v${RAILWAY_VERSION}`;

export const RAILWAY_ASSETS: VerifiedPlatformAsset[] = [
	{
		platform: 'linux',
		arch: 'x64',
		assetName: `railway-v${RAILWAY_VERSION}-x86_64-unknown-linux-gnu.tar.gz`,
		archiveKind: 'tar.gz',
		sha256: 'ced014a566bc273ce87463678a2d1e5d9ee02f165a832d5d2fd27c201855145b',
	},
	{
		platform: 'linux',
		arch: 'arm64',
		assetName: `railway-v${RAILWAY_VERSION}-aarch64-unknown-linux-musl.tar.gz`,
		archiveKind: 'tar.gz',
		sha256: 'b6100a01d0bd5d349f39e796a907e77f45dadb42f99eee558a1aa7bb254b973e',
	},
	{
		platform: 'darwin',
		arch: 'x64',
		assetName: `railway-v${RAILWAY_VERSION}-x86_64-apple-darwin.tar.gz`,
		archiveKind: 'tar.gz',
		sha256: '403721baa47c2afd0391190310ae8aaf9d671d3ac3d7db123219686b2762bea3',
	},
	{
		platform: 'darwin',
		arch: 'arm64',
		assetName: `railway-v${RAILWAY_VERSION}-aarch64-apple-darwin.tar.gz`,
		archiveKind: 'tar.gz',
		sha256: '83ddc35f9a5ec1a8adb4cf6a024f23227b109832b2d354633a9668c47acb02fa',
	},
];

export const NPM_TOOLS: Array<{
	name: Extract<ManagedToolName, 'wrangler' | 'copilot' | 'copilot-language-server'>;
	packageName: string;
	binName: string;
	version: string;
	runtimeBinary?: (packageRoot: string) => string;
}> = [
	{ name: 'wrangler', packageName: 'wrangler', binName: 'wrangler', version: '4.86.0' },
	{ name: 'copilot', packageName: '@github/copilot', binName: 'copilot', version: '1.0.39' },
	{ name: 'copilot-language-server', packageName: '@github/copilot-language-server', binName: 'copilot-language-server', version: '1.480.0' },
];

export const NPM_PACKAGES: Array<{
	name: Extract<ManagedToolName, 'copilot-sdk'>;
	packageName: string;
	version: string;
}> = [
	{ name: 'copilot-sdk', packageName: '@github/copilot-sdk', version: '0.3.0' },
];

export function report(input: Omit<DependencyReport, 'binaryPath'> & { binaryPath?: string | null }): DependencyReport {
	return {
		binaryPath: input.binaryPath ?? null,
		...input,
	};
}

export function sha256File(filePath: string) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function resolveToolsHome(env: NodeJS.ProcessEnv = process.env) {
	if (env.TREESEED_TOOLS_HOME?.trim()) {
		return resolve(env.TREESEED_TOOLS_HOME);
	}
	if (env.XDG_CACHE_HOME?.trim()) {
		return resolve(env.XDG_CACHE_HOME, 'treeseed', 'tools');
	}
	return resolve(process.cwd(), '.treeseed', 'tools');
}

export function createManagedToolEnv(env: NodeJS.ProcessEnv = process.env) {
	const toolsHome = resolveToolsHome(env);
	const ghBinDir = resolve(toolsHome, 'gh', GH_VERSION, platformKey(), 'bin');
	const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
	const existingPath = env[pathKey] ?? env.PATH ?? '';
	return {
		...withServiceCredentialEnv(env),
		GH_CONFIG_DIR: env.TREESEED_GH_CONFIG_DIR ?? resolve(toolsHome, 'gh-config'),
		GH_PROMPT_DISABLED: '1',
		GH_NO_UPDATE_NOTIFIER: '1',
		[pathKey]: [ghBinDir, existingPath].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
	};
}

export function platformKey(platform = osPlatform(), arch = osArch()) {
	return `${platform}-${arch}`;
}

export function currentPlatformAsset(): PlatformAsset | null {
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

export function currentRailwayPlatformAsset(): VerifiedPlatformAsset | null {
	const platform = osPlatform();
	const arch = osArch();
	if (platform !== 'linux' && platform !== 'darwin') return null;
	if (arch !== 'x64' && arch !== 'arm64') return null;
	return RAILWAY_ASSETS.find((asset) => asset.platform === platform && asset.arch === arch) ?? null;
}

export function managedGhBin(env: NodeJS.ProcessEnv = process.env) {
	return resolve(resolveToolsHome(env), 'gh', GH_VERSION, platformKey(), 'bin', 'gh');
}

export function managedRailwayBin(env: NodeJS.ProcessEnv = process.env) {
	return resolve(resolveToolsHome(env), 'railway', RAILWAY_VERSION, platformKey(), 'bin', 'railway');
}

export function tokenEnv(env: NodeJS.ProcessEnv = process.env) {
	const translated = withServiceCredentialEnv(env);
	const ghToken = translated.GH_TOKEN?.trim() || translated.GITHUB_TOKEN?.trim() || '';
	return ghToken
		? {
			...translated,
			GH_TOKEN: ghToken,
			GITHUB_TOKEN: ghToken,
		}
		: translated;
}

export function cleanCommandPathOutput(output: string) {
	const lines = output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (lines[index]?.startsWith('/')) {
			return lines[index] ?? null;
		}
	}
	return lines[lines.length - 1] ?? null;
}
