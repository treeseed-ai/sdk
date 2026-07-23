import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, renameSync, chmodSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { platform as osPlatform, arch as osArch } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { withTreeseedServiceCredentialEnv } from '../service-credentials.ts';
import { DependencyInstallerOptions, GH_VERSION, NPM_PACKAGES, NPM_TOOLS, RAILWAY_VERSION, TreeseedDependencyInstallResult, TreeseedDependencyReport, TreeseedToolStatusResult, createTreeseedManagedToolEnv, managedGhBin, managedRailwayBin, report, resolveToolsHome } from './require.ts';
import { checkGitHubAuth, defaultDownloadFile, invocationForTool, resolveTreeseedToolBinary, runNpmToolRebuilds } from './run-npm-tool-rebuilds.ts';
import { checkCommand, locateSystemBinary } from './redact-sensitive-output.ts';
import { runNpmBootstrap } from './collect-native-dependency-repairs.ts';
import { installGh, installRailway, statusForNpmPackage, statusForNpmTool, systemStatus } from './install-gh.ts';

export function installGhAct(options: DependencyInstallerOptions): TreeseedDependencyReport {
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
	const npmInstalls = [
		...runNpmBootstrap(effectiveOptions),
		...runNpmToolRebuilds(effectiveOptions),
	];
	const reports: TreeseedDependencyReport[] = [
		systemStatus('git', true, effectiveOptions),
		await installGh(effectiveOptions),
		await installRailway(effectiveOptions),
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
	const railwayBinary = managedRailwayBin(env);
	const railwayStatus = report({
		name: 'railway',
		kind: 'download',
		version: RAILWAY_VERSION,
		source: 'managed-cache',
		binaryPath: railwayBinary,
		status: existsSync(railwayBinary) ? 'already-present' : 'missing',
		required: true,
		detail: existsSync(railwayBinary)
			? `Railway CLI ${RAILWAY_VERSION} is installed in the Treeseed tool cache.`
			: `Railway CLI ${RAILWAY_VERSION} is not installed in the Treeseed tool cache.`,
	});
	const reports = [
		systemStatus('git', true, options),
		ghStatus,
		railwayStatus,
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

export function collectTreeseedToolStatus(options: DependencyInstallerOptions = {}): TreeseedToolStatusResult {
	const env = options.env ?? process.env;
	const status = collectTreeseedDependencyStatus(options);
	const tools = status.reports.map((entry) => ({
		...entry,
		invocation: invocationForTool(entry.name, env),
	}));
	return {
		...status,
		tools,
		auth: {
			github: checkGitHubAuth(options),
		},
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
