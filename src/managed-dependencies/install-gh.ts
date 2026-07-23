import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, renameSync, chmodSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { platform as osPlatform, arch as osArch } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { withTreeseedServiceCredentialEnv } from '../service-credentials.ts';
import { DependencyInstallerOptions, GH_CHECKSUMS_SHA256, GH_RELEASE_BASE_URL, GH_VERSION, NPM_PACKAGES, NPM_TOOLS, RAILWAY_RELEASE_BASE_URL, RAILWAY_VERSION, TreeseedDependencyReport, createTreeseedManagedToolEnv, currentPlatformAsset, currentRailwayPlatformAsset, managedGhBin, managedRailwayBin, report, resolveToolsHome, sha256File } from './require.ts';
import { checkCommand, locateSystemBinary, npmToolMissingDetail, resolveNpmToolRuntimeBinary, resolvePackageRoot } from './redact-sensitive-output.ts';
import { findExtractedGhBinary, parseChecksums } from './run-npm-tool-rebuilds.ts';

export async function installGh(options: Required<Pick<DependencyInstallerOptions, 'env' | 'downloadFile' | 'spawn'>> & Pick<DependencyInstallerOptions, 'tenantRoot' | 'force' | 'write'>): Promise<TreeseedDependencyReport> {
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

export async function installRailway(options: Required<Pick<DependencyInstallerOptions, 'env' | 'downloadFile' | 'spawn'>> & Pick<DependencyInstallerOptions, 'tenantRoot' | 'force' | 'write'>): Promise<TreeseedDependencyReport> {
	const asset = currentRailwayPlatformAsset();
	if (!asset) {
		return report({
			name: 'railway',
			kind: 'download',
			version: RAILWAY_VERSION,
			source: 'not-applicable',
			status: 'unsupported',
			required: true,
			detail: 'Managed Railway CLI installation supports Linux and macOS on x64 or arm64.',
		});
	}
	const binaryPath = managedRailwayBin(options.env);
	if (existsSync(binaryPath)) {
		const check = checkCommand(binaryPath, ['--version'], {
			cwd: options.tenantRoot,
			env: options.env,
			spawn: options.spawn,
		});
		if (check.ok && check.stdout.includes(RAILWAY_VERSION)) {
			return report({
				name: 'railway', kind: 'download', version: RAILWAY_VERSION, source: 'managed-cache',
				binaryPath, status: options.force ? 'repaired' : 'already-present', required: true,
				detail: check.stdout.split('\n')[0] ?? `Railway CLI ${RAILWAY_VERSION} is installed.`,
			});
		}
	}

	const toolsHome = resolveToolsHome(options.env);
	const tmpRoot = resolve(toolsHome, '.tmp', `railway-${process.pid}-${Date.now()}`);
	const archivePath = resolve(tmpRoot, asset.assetName);
	const extractRoot = resolve(tmpRoot, 'extract');
	const installRoot = dirname(dirname(binaryPath));
	const stagingRoot = `${installRoot}.staging-${process.pid}-${Date.now()}`;
	try {
		options.write?.(`Installing Railway CLI ${RAILWAY_VERSION}...`);
		rmSync(tmpRoot, { recursive: true, force: true });
		mkdirSync(extractRoot, { recursive: true });
		await options.downloadFile(`${RAILWAY_RELEASE_BASE_URL}/${asset.assetName}`, archivePath);
		const assetHash = sha256File(archivePath);
		if (assetHash !== asset.sha256) {
			throw new Error(`Railway CLI archive hash mismatch for ${asset.assetName}: expected ${asset.sha256}, got ${assetHash}.`);
		}
		const tar = await import('tar');
		await tar.x({ file: archivePath, cwd: extractRoot });
		const extractedBinary = resolve(extractRoot, 'railway');
		if (!existsSync(extractedBinary)) throw new Error(`Unable to find railway binary in ${asset.assetName}.`);
		rmSync(stagingRoot, { recursive: true, force: true });
		mkdirSync(resolve(stagingRoot, 'bin'), { recursive: true });
		copyFileSync(extractedBinary, resolve(stagingRoot, 'bin', 'railway'));
		chmodSync(resolve(stagingRoot, 'bin', 'railway'), 0o755);
		rmSync(installRoot, { recursive: true, force: true });
		mkdirSync(dirname(installRoot), { recursive: true });
		renameSync(stagingRoot, installRoot);
		const check = checkCommand(binaryPath, ['--version'], { cwd: options.tenantRoot, env: options.env, spawn: options.spawn });
		if (!check.ok || !check.stdout.includes(RAILWAY_VERSION)) {
			throw new Error(check.detail || `Railway CLI ${RAILWAY_VERSION} failed after installation.`);
		}
		return report({
			name: 'railway', kind: 'download', version: RAILWAY_VERSION, source: 'managed-cache', binaryPath,
			status: options.force ? 'repaired' : 'installed', required: true,
			detail: check.stdout.split('\n')[0] ?? `Railway CLI ${RAILWAY_VERSION} installed.`,
		});
	} catch (error) {
		return report({
			name: 'railway', kind: 'download', version: RAILWAY_VERSION, source: 'managed-cache', binaryPath,
			status: 'failed', required: true, detail: error instanceof Error ? error.message : String(error),
		});
	} finally {
		rmSync(tmpRoot, { recursive: true, force: true });
		rmSync(stagingRoot, { recursive: true, force: true });
	}
}

export function statusForNpmTool(tool: (typeof NPM_TOOLS)[number], options: DependencyInstallerOptions): TreeseedDependencyReport {
	try {
		const binaryPath = resolveNpmToolRuntimeBinary(tool);
		return report({
			name: tool.name,
			kind: 'npm',
			version: tool.version,
			source: 'package',
			binaryPath,
			status: binaryPath && existsSync(binaryPath) ? 'already-present' : 'missing',
			required: true,
			detail: binaryPath && existsSync(binaryPath)
				? `${tool.packageName} is available from the Treeseed SDK dependency graph.`
				: npmToolMissingDetail(tool),
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

export function statusForNpmPackage(pkg: (typeof NPM_PACKAGES)[number]): TreeseedDependencyReport {
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

export function systemStatus(name: 'git' | 'docker', required: boolean, options: DependencyInstallerOptions): TreeseedDependencyReport {
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
