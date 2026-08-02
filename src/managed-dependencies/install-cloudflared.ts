import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DependencyInstallerOptions, DependencyReport } from './dependency-runtime.ts';
import { CLOUDFLARED_RELEASE_BASE_URL, CLOUDFLARED_VERSION, currentCloudflaredPlatformAsset, managedCloudflaredBin, report, resolveToolsHome, sha256File } from './dependency-runtime.ts';
import { checkCommand } from './redact-sensitive-output.ts';

export async function installCloudflared(options: Required<Pick<DependencyInstallerOptions, 'env' | 'downloadFile' | 'spawn'>> & Pick<DependencyInstallerOptions, 'tenantRoot' | 'force' | 'write'>): Promise<DependencyReport> {
	const asset = currentCloudflaredPlatformAsset();
	if (!asset) return report({ name: 'cloudflared', kind: 'download', version: CLOUDFLARED_VERSION, source: 'not-applicable', status: 'unsupported', required: false, detail: 'Managed cloudflared supports Linux and macOS on x64 or arm64.' });
	const binaryPath = managedCloudflaredBin(options.env);
	const existing = existsSync(binaryPath) ? checkCommand(binaryPath, ['version'], { cwd: options.tenantRoot, env: options.env, spawn: options.spawn }) : null;
	if (existing?.ok && existing.stdout.includes(CLOUDFLARED_VERSION) && !options.force) return report({ name: 'cloudflared', kind: 'download', version: CLOUDFLARED_VERSION, source: 'managed-cache', binaryPath, status: 'already-present', required: false, detail: existing.stdout.split('\n')[0] ?? 'cloudflared is installed.' });
	const toolsHome = resolveToolsHome(options.env); const tmpRoot = resolve(toolsHome, '.tmp', `cloudflared-${process.pid}-${Date.now()}`);
	const downloadPath = resolve(tmpRoot, asset.assetName); const extractRoot = resolve(tmpRoot, 'extract');
	const installRoot = dirname(dirname(binaryPath)); const stagingRoot = `${installRoot}.staging-${process.pid}-${Date.now()}`;
	try {
		options.write?.(`Installing cloudflared ${CLOUDFLARED_VERSION}...`); mkdirSync(extractRoot, { recursive: true });
		await options.downloadFile(`${CLOUDFLARED_RELEASE_BASE_URL}/${asset.assetName}`, downloadPath);
		const digest = sha256File(downloadPath); if (digest !== asset.sha256) throw new Error(`cloudflared checksum mismatch: expected ${asset.sha256}, got ${digest}.`);
		let extracted = downloadPath;
		if (asset.archiveKind === 'tar.gz') { const tar = await import('tar'); await tar.x({ file: downloadPath, cwd: extractRoot }); extracted = resolve(extractRoot, 'cloudflared'); }
		if (!existsSync(extracted)) throw new Error(`Unable to find cloudflared in ${asset.assetName}.`);
		mkdirSync(resolve(stagingRoot, 'bin'), { recursive: true }); copyFileSync(extracted, resolve(stagingRoot, 'bin', 'cloudflared')); chmodSync(resolve(stagingRoot, 'bin', 'cloudflared'), 0o755);
		rmSync(installRoot, { recursive: true, force: true }); mkdirSync(dirname(installRoot), { recursive: true }); renameSync(stagingRoot, installRoot);
		const check = checkCommand(binaryPath, ['version'], { cwd: options.tenantRoot, env: options.env, spawn: options.spawn });
		if (!check.ok || !check.stdout.includes(CLOUDFLARED_VERSION)) throw new Error(check.detail || 'cloudflared failed after installation.');
		return report({ name: 'cloudflared', kind: 'download', version: CLOUDFLARED_VERSION, source: 'managed-cache', binaryPath, status: existing?.ok ? 'repaired' : 'installed', required: false, detail: check.stdout.split('\n')[0] ?? 'cloudflared installed.' });
	} catch (error) {
		return report({ name: 'cloudflared', kind: 'download', version: CLOUDFLARED_VERSION, source: 'managed-cache', binaryPath, status: 'failed', required: false, detail: error instanceof Error ? error.message : String(error) });
	} finally { rmSync(tmpRoot, { recursive: true, force: true }); rmSync(stagingRoot, { recursive: true, force: true }); }
}
