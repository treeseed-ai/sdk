import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function createWorkspaceActWorkflow(options: {
	workspaceRoot: string;
	packageRoot: string;
	eventName: string;
	localTreeseedSiblingDependencies: string[];
}) {
	const relativePackageRoot = relative(options.workspaceRoot, options.packageRoot).replace(/\\/g, '/');
	const siblingPreparationCommands = options.localTreeseedSiblingDependencies
		.map((packageName) => {
			const packageDir = `packages/${packageName.split('/')[1]}`;
			const manifest = readPackageManifest(resolve(options.workspaceRoot, packageDir, 'package.json'));
			if (!manifest) {
				return null;
			}

			const commands = [
				`if test -f ${packageDir}/package-lock.json; then`,
				`  npm --prefix ${packageDir} ci --workspaces=false`,
				'else',
				`  npm --prefix ${packageDir} install --workspaces=false --no-audit --no-fund`,
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
      TREESEED_GITHUB_AUTOMATION_MODE: stub
      TREESEED_STAGE_WAIT_MODE: skip
      TREESEED_AGENT_DISABLE_GIT: "true"
      TREESEED_FIXTURE_ID: treeseed-working-site
    steps:
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
${siblingPreparationCommands.split('\n').map((line) => `          ${line}`).join('\n')}

` : ''}      - name: Install dependencies
        run: |
          if test -f package-lock.json; then
            npm ci --workspaces=false
          else
            npm install --workspaces=false --no-audit --no-fund
          fi

      - name: Verify package
        run: npm run verify:direct
`,
		'utf8',
	);

	return {
		cwd: options.workspaceRoot,
		args: ['act', options.eventName, '-W', workflowPath, '-j', 'verify'],
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
			return runCommand(gh, workspaceAct.args, workspaceAct.cwd);
		}
		return runCommand(gh, ['act', status.eventName, '-W', '.github/workflows/verify.yml', '-j', 'verify'], status.packageRoot);
	}

	if (status.prefersDirectForLocalWorkspace) {
		return runCommand('npm', ['run', 'verify:direct'], status.packageRoot);
	}

	if (status.canUseAct) {
		return runCommand(gh, ['act', status.eventName, '-W', '.github/workflows/verify.yml', '-j', 'verify'], status.packageRoot);
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
