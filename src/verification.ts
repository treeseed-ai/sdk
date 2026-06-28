import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as childProcess from 'node:child_process';
import { basename, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createTreeseedManagedToolEnv, resolveTreeseedToolBinary } from './managed-dependencies.ts';

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

type PackageManifest = {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
};

type LocalWorkspaceContext = {
	workspaceRoot: string | null;
	currentPackageName: string | null;
	localTreeseedPackageNames: string[];
	localTreeseedSiblingDependencies: string[];
};

const defaultActUbuntuLatestImage = 'catthehacker/ubuntu:act-latest';
const actLockStaleAfterMs = 2 * 60 * 60 * 1000;
const actLockPollMs = 500;

function defaultWrite(message: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!message) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${message}\n`);
}

function run(command: string, args: string[], cwd: string) {
	const result = childProcess.spawnSync(command, args, {
		cwd,
		env: createTreeseedManagedToolEnv(process.env),
		stdio: 'inherit',
	});
	return result.status ?? 1;
}

function check(command: string, args: string[], cwd: string) {
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

function readPackageManifest(packageJsonPath: string): PackageManifest | null {
	if (!existsSync(packageJsonPath)) {
		return null;
	}

	try {
		return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest;
	} catch {
		return null;
	}
}

function allocateActServerPorts() {
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

function createActArgs(eventName: string, workflowPath: string) {
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

function sleepSync(ms: number) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireActLock() {
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

function runActCommand(runCommand: (command: string, args: string[], cwd: string) => number, command: string, args: string[], cwd: string) {
	const releaseLock = acquireActLock();
	try {
		return runCommand(command, args, cwd);
	} finally {
		releaseLock();
	}
}

function createWorkspaceActWorkflow(options: {
	workspaceRoot: string;
	packageRoot: string;
	eventName: string;
	localTreeseedSiblingDependencies: string[];
}) {
	const relativePackageRoot = relative(options.workspaceRoot, options.packageRoot).replace(/\\/g, '/');
	const siblingLinkCommands = options.localTreeseedSiblingDependencies
		.map((packageName) => {
			const [, packageShortName] = packageName.split('/');
			const packageDir = `packages/${packageShortName}`;
			const packageScope = packageName.split('/')[0];
			const linkParent = `node_modules/${packageScope}`;
			const linkTarget = relative(
				resolve(options.packageRoot, linkParent),
				resolve(options.workspaceRoot, packageDir),
			).replace(/\\/g, '/');
			return [
				`mkdir -p ${linkParent}`,
				`rm -rf ${linkParent}/${packageShortName}`,
				`ln -s ${linkTarget} ${linkParent}/${packageShortName}`,
			].join('\n');
		})
		.join('\n');
	const npmRetryFunction = [
		'treeseed_npm_retry() {',
		'  attempt=1',
		'  until npm "$@"; do',
		'    status=$?',
		'    if test "$attempt" -ge 3; then',
		'      return "$status"',
		'    fi',
		'    echo "npm $* failed with $status; retrying in $((attempt * 5))s" >&2',
		'    sleep $((attempt * 5))',
		'    attempt=$((attempt + 1))',
		'  done',
		'}',
	].join('\n');
	const siblingPreparationCommands = options.localTreeseedSiblingDependencies
		.map((packageName) => {
			const packageDir = `packages/${packageName.split('/')[1]}`;
			const manifest = readPackageManifest(resolve(options.workspaceRoot, packageDir, 'package.json'));
			if (!manifest) {
				return null;
			}

			const commands = [
				`if test -f ${packageDir}/package-lock.json; then`,
				`  treeseed_npm_retry --prefix ${packageDir} ci --workspaces=false`,
				'else',
				`  treeseed_npm_retry --prefix ${packageDir} install --workspaces=false --no-audit --no-fund`,
				'fi',
			];
			if (manifest.scripts?.['build:dist']) {
				commands.push(`npm --prefix ${packageDir} run build:dist`);
			}
			return commands.join('\n');
		})
		.filter((command): command is string => Boolean(command))
		.join('\n');
	const workflowRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-verify-act-'));
	const workflowPath = resolve(workflowRoot, 'verify.yml');
	const isolatedPackageVerifyEnv = process.env.TREESEED_VERIFY_PACKAGE_ISOLATED === '1'
		? '      TREESEED_VERIFY_PACKAGE_ISOLATED: "1"\n'
		: '';
	writeFileSync(
		workflowPath,
		`name: Treeseed Local Verify

on:
  workflow_dispatch:

jobs:
  verify:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ${relativePackageRoot}
    env:
      CI: "true"
      TREESEED_STAGE_WAIT_MODE: skip
      TREESEED_AGENT_DISABLE_GIT: "true"
      TREESEED_FIXTURE_ID: treeseed-working-site
${isolatedPackageVerifyEnv}    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24.12.0

      - name: Assert node:sqlite availability
        run: node -e "import('node:sqlite').then(() => console.log('node:sqlite available')).catch((error) => { console.error(error); process.exit(1); })"

${siblingPreparationCommands ? `      - name: Prepare sibling packages
        working-directory: .
        run: |
${npmRetryFunction.split('\n').map((line) => `          ${line}`).join('\n')}
${siblingPreparationCommands.split('\n').map((line) => `          ${line}`).join('\n')}

` : ''}      - name: Install dependencies
        run: |
${npmRetryFunction.split('\n').map((line) => `          ${line}`).join('\n')}
          node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync('package.json', 'utf8')); if (p.scripts) delete p.scripts.prepare; fs.writeFileSync('package.json', JSON.stringify(p, null, '\\t') + '\\n');"
          if test -f package-lock.json; then
            treeseed_npm_retry ci --workspaces=false
          else
            treeseed_npm_retry install --workspaces=false --no-audit --no-fund
          fi
          if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
            git checkout -- package.json
          fi

${siblingLinkCommands ? `      - name: Link local Treeseed dependencies
        run: |
${siblingLinkCommands.split('\n').map((line) => `          ${line}`).join('\n')}

` : ''}      - name: Verify package
        run: npm run verify:direct
`,
		'utf8',
	);

	return {
		cwd: options.workspaceRoot,
		args: createActArgs(options.eventName, workflowPath),
	};
}

function findWorkspaceRoot(packageRoot: string) {
	let current = packageRoot;
	while (true) {
		const packagesRoot = resolve(current, 'packages');
		if (existsSync(packagesRoot)) {
			const packageDirs = readdirSync(packagesRoot, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => resolve(packagesRoot, entry.name))
				.filter((dirPath) => existsSync(resolve(dirPath, 'package.json')));
			if (packageDirs.length > 0) {
				return {
					workspaceRoot: current,
					packageDirs,
				};
			}
		}

		const parent = resolve(current, '..');
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

function resolveLocalWorkspaceContext(packageRoot: string, extraSiblingDependencies: readonly string[] = []): LocalWorkspaceContext {
	const currentManifest = readPackageManifest(resolve(packageRoot, 'package.json'));
	const currentPackageName = typeof currentManifest?.name === 'string' ? currentManifest.name : null;
	const workspace = findWorkspaceRoot(packageRoot);

	if (!workspace) {
		return {
			workspaceRoot: null,
			currentPackageName,
			localTreeseedPackageNames: [],
			localTreeseedSiblingDependencies: [],
		};
	}

	const localPackages = workspace.packageDirs
		.map((dirPath) => ({
			dirPath,
			manifest: readPackageManifest(resolve(dirPath, 'package.json')),
		}))
		.filter((entry): entry is { dirPath: string; manifest: PackageManifest } => Boolean(entry.manifest?.name));

	const currentPackage = localPackages.find((entry) => entry.dirPath === packageRoot);
	if (!currentPackage) {
		return {
			workspaceRoot: null,
			currentPackageName,
			localTreeseedPackageNames: [],
			localTreeseedSiblingDependencies: [],
		};
	}

	const localTreeseedPackageNames = localPackages
		.map((entry) => entry.manifest.name as string)
		.filter((name) => name.startsWith('@treeseed/'))
		.sort();
	const localTreeseedPackageSet = new Set(localTreeseedPackageNames);
	const declaredDependencies = {
		...(currentPackage.manifest.dependencies ?? {}),
		...(currentPackage.manifest.devDependencies ?? {}),
		...(currentPackage.manifest.peerDependencies ?? {}),
	};
	const declaredLocalTreeseedSiblingDependencies = Object.keys(declaredDependencies)
		.filter((name) => name.startsWith('@treeseed/'))
		.filter((name) => localTreeseedPackageSet.has(name))
		.sort();
	const extraLocalTreeseedSiblingDependencies = extraSiblingDependencies
		.filter((name) => name.startsWith('@treeseed/'))
		.filter((name) => localTreeseedPackageSet.has(name))
		.sort();
	const localTreeseedSiblingDependencies = [
		...declaredLocalTreeseedSiblingDependencies,
		...extraLocalTreeseedSiblingDependencies.filter((name) => !declaredLocalTreeseedSiblingDependencies.includes(name)),
	];

	return {
		workspaceRoot: workspace.workspaceRoot,
		currentPackageName: currentPackage.manifest.name ?? currentPackageName,
		localTreeseedPackageNames,
		localTreeseedSiblingDependencies,
	};
}

export function getTreeseedVerifyDriverStatus(options: TreeseedVerifyDriverOptions = {}): TreeseedVerifyDriverStatus {
	const packageRoot = resolve(options.packageRoot ?? process.cwd());
	const workflowPath = resolve(packageRoot, '.github', 'workflows', 'verify.yml');
	const driver = options.driver ?? (process.env.TREESEED_VERIFY_DRIVER as TreeseedVerifyDriver | undefined) ?? 'auto';
	const eventName = options.eventName ?? process.env.TREESEED_VERIFY_EVENT ?? 'workflow_dispatch';
	const inGitHubActions = process.env.GITHUB_ACTIONS === 'true';
	const workflowPresent = existsSync(workflowPath);
	const workspace = resolveLocalWorkspaceContext(packageRoot, options.localTreeseedExtraSiblingDependencies ?? []);
	const checkCommand = options.checkCommand ?? check;
	const gh = options.checkCommand ? 'gh' : (resolveTreeseedToolBinary('gh') ?? 'gh');
	const ghAct = checkCommand(gh, ['act', '--version'], packageRoot);
	const docker = checkCommand('docker', ['info'], packageRoot);
	const prefersDirectForLocalWorkspace =
		!inGitHubActions &&
		driver === 'auto' &&
		workspace.localTreeseedSiblingDependencies.length > 0;

	return {
		packageRoot,
		workflowPath,
		driver,
		eventName,
		inGitHubActions,
		workflowPresent,
		ghActAvailable: ghAct.ok,
		dockerAvailable: docker.ok,
		canUseAct: workflowPresent && ghAct.ok && docker.ok,
		workspaceRoot: workspace.workspaceRoot,
		currentPackageName: workspace.currentPackageName,
		localTreeseedPackageNames: workspace.localTreeseedPackageNames,
		localTreeseedSiblingDependencies: workspace.localTreeseedSiblingDependencies,
		prefersDirectForLocalWorkspace,
	};
}

export function runTreeseedVerifyDriver(options: TreeseedVerifyDriverOptions = {}) {
	const write = options.write ?? defaultWrite;
	const status = getTreeseedVerifyDriverStatus(options);
	const runCommand = options.runCommand ?? run;
	const checkCommand = options.checkCommand ?? check;
	const gh = options.runCommand || options.checkCommand ? 'gh' : (resolveTreeseedToolBinary('gh') ?? 'gh');

	if (status.driver === 'direct' || status.inGitHubActions) {
		return runCommand('npm', ['run', 'verify:direct'], status.packageRoot);
	}

	if (status.driver === 'act') {
		if (!status.workflowPresent) {
			write(`Treeseed verify requires ${status.workflowPath} when TREESEED_VERIFY_DRIVER=act.`, 'stderr');
			return 1;
		}
		if (!status.ghActAvailable) {
			const detail = checkCommand(gh, ['act', '--version'], status.packageRoot).detail;
			write(detail || 'Treeseed verify requires `gh act` when TREESEED_VERIFY_DRIVER=act.', 'stderr');
			return 1;
		}
		if (!status.dockerAvailable) {
			const detail = checkCommand('docker', ['info'], status.packageRoot).detail;
			write(detail || 'Treeseed verify requires a running Docker daemon when TREESEED_VERIFY_DRIVER=act.', 'stderr');
			return 1;
		}
		if (status.workspaceRoot && status.localTreeseedSiblingDependencies.length > 0) {
			const workspaceAct = createWorkspaceActWorkflow({
				workspaceRoot: status.workspaceRoot,
				packageRoot: status.packageRoot,
				eventName: status.eventName,
				localTreeseedSiblingDependencies: status.localTreeseedSiblingDependencies,
			});
			return runActCommand(runCommand, gh, workspaceAct.args, workspaceAct.cwd);
		}
		return runActCommand(runCommand, gh, createActArgs(status.eventName, '.github/workflows/verify.yml'), status.packageRoot);
	}

	if (status.prefersDirectForLocalWorkspace) {
		return runCommand('npm', ['run', 'verify:direct'], status.packageRoot);
	}

	if (status.canUseAct) {
		return runActCommand(runCommand, gh, createActArgs(status.eventName, '.github/workflows/verify.yml'), status.packageRoot);
	}

	if (!status.workflowPresent) {
		write('Treeseed verify warning: package-local verify workflow is missing; falling back to verify:direct.', 'stderr');
	} else if (!status.ghActAvailable) {
		write('Treeseed verify warning: `gh act` is unavailable; falling back to verify:direct.', 'stderr');
	} else if (!status.dockerAvailable) {
		write('Treeseed verify warning: Docker is unavailable; falling back to verify:direct.', 'stderr');
	}

	return runCommand('npm', ['run', 'verify:direct'], status.packageRoot);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const invokedBasename = basename(invokedPath);
const modulePath = fileURLToPath(import.meta.url);
const moduleBasename = basename(modulePath);
const invokedAsVerificationEntrypoint =
	invokedPath === modulePath ||
	/^verification\.(?:ts|js|mjs|cjs)$/.test(invokedBasename) ||
	invokedBasename === moduleBasename;

if (invokedAsVerificationEntrypoint) {
	process.exit(runTreeseedVerifyDriver());
}
