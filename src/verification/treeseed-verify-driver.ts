import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as childProcess from 'node:child_process';
import { basename, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createTreeseedManagedToolEnv, resolveTreeseedToolBinary } from '../managed-dependencies.ts';


export type TreeseedVerifyDriver = 'auto' | 'act' | 'direct';

export type TreeseedVerifyDriverOptions = {
	packageRoot?: string;
	driver?: TreeseedVerifyDriver;
	eventName?: string;
	localTreeseedExtraSiblingDependencies?: string[];
	write?: (message: string, stream?: 'stdout' | 'stderr') => void;
	runCommand?: (command: string, args: string[], cwd: string) => number;
	checkCommand?: (command: string, args: string[], cwd: string) => { ok: boolean; detail: string };
};

export type TreeseedVerifyDriverStatus = {
	packageRoot: string;
	workflowPath: string;
	driver: TreeseedVerifyDriver;
	eventName: string;
	inGitHubActions: boolean;
	workflowPresent: boolean;
	ghActAvailable: boolean;
	dockerAvailable: boolean;
	canUseAct: boolean;
	workspaceRoot: string | null;
	currentPackageName: string | null;
	localTreeseedPackageNames: string[];
	localTreeseedSiblingDependencies: string[];
	prefersDirectForLocalWorkspace: boolean;
};

// Command model:
// - `verify` uses auto mode and lets the shared driver decide.
// - `verify:local` forces `direct`, which runs the package's `verify:direct` script.
// - `verify:action` forces `act`, which runs the package workflow through `gh act`.
// - `verify:direct` is the raw package-local verification body.

export type PackageManifest = {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
};

export type LocalWorkspaceContext = {
	workspaceRoot: string | null;
	currentPackageName: string | null;
	localTreeseedPackageNames: string[];
	localTreeseedSiblingDependencies: string[];
};

export const defaultActUbuntuLatestImage = 'catthehacker/ubuntu:act-latest';

export const actLockStaleAfterMs = 2 * 60 * 60 * 1000;

export const actLockPollMs = 500;

export function defaultWrite(message: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!message) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${message}\n`);
}

export function run(command: string, args: string[], cwd: string) {
	const result = childProcess.spawnSync(command, args, {
		cwd,
		env: createTreeseedManagedToolEnv(process.env),
		stdio: 'inherit',
	});
	return result.status ?? 1;
}

export function check(command: string, args: string[], cwd: string) {
	const result = childProcess.spawnSync(command, args, {
		cwd,
		env: createTreeseedManagedToolEnv(process.env),
		stdio: 'pipe',
		encoding: 'utf8',
	});
	return {
		ok: result.status === 0,
		detail: `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim(),
	};
}

export function readPackageManifest(packageJsonPath: string): PackageManifest | null {
	if (!existsSync(packageJsonPath)) {
		return null;
	}

	try {
		return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest;
	} catch {
		return null;
	}
}

export function allocateActServerPorts() {
	const result = childProcess.spawnSync(process.execPath, [
		'-e',
		`const net = require('node:net');
const servers = [net.createServer(), net.createServer()];
const ports = [];
let remaining = servers.length;
function fail(error) {
	console.error(error && error.stack ? error.stack : String(error));
	process.exit(1);
}
for (const server of servers) {
	server.once('error', fail);
	server.listen(0, '127.0.0.1', () => {
		const address = server.address();
		if (!address || typeof address === 'string') fail(new Error('Unable to allocate TCP port.'));
		ports.push(address.port);
		server.close(() => {
			remaining -= 1;
			if (remaining === 0) {
				console.log(JSON.stringify(ports));
			}
		});
	});
}`,
	], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	if (result.status !== 0) {
		const detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim();
		throw new Error(`Unable to allocate local act server ports.${detail ? `\n${detail}` : ''}`);
	}

	const ports = JSON.parse(result.stdout.trim()) as unknown;
	if (
		!Array.isArray(ports)
		|| ports.length !== 2
		|| ports.some((port) => !Number.isInteger(port) || port <= 0)
	) {
		throw new Error(`Unable to allocate local act server ports: ${result.stdout.trim()}`);
	}

	return {
		artifactServerPort: String(ports[0]),
		cacheServerPort: String(ports[1]),
	};
}

export function createActArgs(eventName: string, workflowPath: string) {
	const image = process.env.TREESEED_VERIFY_ACT_UBUNTU_LATEST_IMAGE?.trim() || defaultActUbuntuLatestImage;
	const ports = allocateActServerPorts();
	const args = [
		'act',
		eventName,
		'-W',
		workflowPath,
		'-j',
		'verify',
		'--artifact-server-port',
		ports.artifactServerPort,
		'--cache-server-port',
		ports.cacheServerPort,
	];
	if (image) {
		args.push('-P', `ubuntu-latest=${image}`);
	}
	return args;
}

export function sleepSync(ms: number) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function acquireActLock() {
	const lockDir = resolve(tmpdir(), 'treeseed-verify-act.lock');
	const owner = `${process.pid}:${Date.now()}`;
	while (true) {
		try {
			mkdirSync(lockDir);
			writeFileSync(resolve(lockDir, 'owner'), owner, 'utf8');
			return () => {
				try {
					const currentOwner = readFileSync(resolve(lockDir, 'owner'), 'utf8');
					if (currentOwner === owner) {
						rmSync(lockDir, { recursive: true, force: true });
					}
				} catch {
					// Another process may have already removed a stale lock.
				}
			};
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== 'EEXIST') {
				throw error;
			}
			try {
				const ageMs = Date.now() - statSync(lockDir).mtimeMs;
				if (ageMs > actLockStaleAfterMs) {
					rmSync(lockDir, { recursive: true, force: true });
					continue;
				}
			} catch {
				rmSync(lockDir, { recursive: true, force: true });
				continue;
			}
			sleepSync(actLockPollMs);
		}
	}
}

export function runActCommand(runCommand: (command: string, args: string[], cwd: string) => number, command: string, args: string[], cwd: string) {
	const releaseLock = acquireActLock();
	try {
		return runCommand(command, args, cwd);
	} finally {
		releaseLock();
	}
}
