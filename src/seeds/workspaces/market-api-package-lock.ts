import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

type LockPackage = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	resolved?: string;
};

type PackageLock = {
	lockfileVersion?: number;
	packages?: Record<string, LockPackage>;
};

function sameEntries(left: Record<string, string> | undefined, right: Record<string, string> | undefined) {
	return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

export function assertMarketApiPackageLock(content: string, packageContent: string, sdkRef: string) {
	const lock = JSON.parse(content) as PackageLock;
	const manifest = JSON.parse(packageContent) as LockPackage;
	const root = lock.packages?.[''];
	const sdk = lock.packages?.['node_modules/@treeseed/sdk'];
	if (lock.lockfileVersion !== 3 || !root || !sdk) throw new Error('Market API package lock must be a complete npm v3 lockfile.');
	if (!sameEntries(root.dependencies, manifest.dependencies) || !sameEntries(root.devDependencies, manifest.devDependencies)) {
		throw new Error('Market API package lock does not match the reconciled package manifest.');
	}
	if (!sdk.resolved?.endsWith(`#${sdkRef}`)) throw new Error(`Market API package lock does not pin SDK commit ${sdkRef}.`);
}

export function generateMarketApiPackageLock(packageContent: string, sdkRef: string) {
	const temporary = mkdtempSync(resolve(tmpdir(), 'trsd-market-api-lock-'));
	try {
		writeFileSync(resolve(temporary, 'package.json'), packageContent, 'utf8');
		execFileSync('npm', ['install', '--package-lock-only', '--workspaces=false', '--ignore-scripts', '--no-audit', '--no-fund'], {
			cwd: temporary,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const content = readFileSync(resolve(temporary, 'package-lock.json'), 'utf8');
		assertMarketApiPackageLock(content, packageContent, sdkRef);
		return content;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}
