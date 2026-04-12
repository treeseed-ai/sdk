import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as childProcess from 'node:child_process';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type TreeseedVerifyDriver = 'auto' | 'act' | 'direct';

export type TreeseedVerifyDriverOptions = {
	packageRoot?: string;
	driver?: TreeseedVerifyDriver;
	eventName?: string;
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
};

type LocalWorkspaceContext = {
	workspaceRoot: string | null;
	currentPackageName: string | null;
	localTreeseedPackageNames: string[];
	localTreeseedSiblingDependencies: string[];
};

function defaultWrite(message: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!message) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${message}\n`);
}

function run(command: string, args: string[], cwd: string) {
	const result = childProcess.spawnSync(command, args, {
		cwd,
		env: process.env,
		stdio: 'inherit',
	});
	return result.status ?? 1;
}

function check(command: string, args: string[], cwd: string) {
	const result = childProcess.spawnSync(command, args, {
		cwd,
		env: process.env,
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

function resolveLocalWorkspaceContext(packageRoot: string): LocalWorkspaceContext {
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
	const localTreeseedSiblingDependencies = Object.keys(declaredDependencies)
		.filter((name) => name.startsWith('@treeseed/'))
		.filter((name) => localTreeseedPackageSet.has(name))
		.sort();

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
	const workspace = resolveLocalWorkspaceContext(packageRoot);
	const checkCommand = options.checkCommand ?? check;
	const ghAct = checkCommand('gh', ['act', '--version'], packageRoot);
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

	if (status.driver === 'direct' || status.inGitHubActions) {
		return runCommand('npm', ['run', 'verify:direct'], status.packageRoot);
	}

	if (status.driver === 'act') {
		if (!status.workflowPresent) {
			write(`Treeseed verify requires ${status.workflowPath} when TREESEED_VERIFY_DRIVER=act.`, 'stderr');
			return 1;
		}
		if (!status.ghActAvailable) {
			const detail = checkCommand('gh', ['act', '--version'], status.packageRoot).detail;
			write(detail || 'Treeseed verify requires `gh act` when TREESEED_VERIFY_DRIVER=act.', 'stderr');
			return 1;
		}
		if (!status.dockerAvailable) {
			const detail = checkCommand('docker', ['info'], status.packageRoot).detail;
			write(detail || 'Treeseed verify requires a running Docker daemon when TREESEED_VERIFY_DRIVER=act.', 'stderr');
			return 1;
		}
		return runCommand('gh', ['act', status.eventName, '-W', '.github/workflows/verify.yml', '-j', 'verify'], status.packageRoot);
	}

	if (status.prefersDirectForLocalWorkspace) {
		return runCommand('npm', ['run', 'verify:direct'], status.packageRoot);
	}

	if (status.canUseAct) {
		return runCommand('gh', ['act', status.eventName, '-W', '.github/workflows/verify.yml', '-j', 'verify'], status.packageRoot);
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
