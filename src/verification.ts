import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as childProcess from 'node:child_process';
import { basename, relative, resolve } from 'node:path';
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

type WorkspacePackage = {
	name: string;
	dir: string;
	relativeDir: string;
	manifest: PackageManifest;
};

const defaultActUbuntuLatestImage = 'catthehacker/ubuntu:act-latest';
const workspacePackageOrder = ['sdk', 'ui', 'core', 'admin', 'cli', 'agent', 'api', 'treedx'];

function defaultWrite(message: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!message) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${message}\n`);
}

function verifyTempRoot(root: string) {
	const configured = process.env.TREESEED_VERIFY_TMPDIR?.trim();
	const base = configured ? resolve(configured) : resolve(root, '.treeseed', 'verify-tmp');
	mkdirSync(base, { recursive: true });
	return base;
}

function verifyProcessEnv(cwd: string) {
	const tempRoot = verifyTempRoot(cwd);
	return {
		...createTreeseedManagedToolEnv(process.env),
		TMPDIR: tempRoot,
		TMP: tempRoot,
		TEMP: tempRoot,
	};
}

function run(command: string, args: string[], cwd: string) {
	const result = childProcess.spawnSync(command, args, {
		cwd,
		env: verifyProcessEnv(cwd),
		stdio: 'inherit',
	});
	return result.status ?? 1;
}

function check(command: string, args: string[], cwd: string) {
	const result = childProcess.spawnSync(command, args, {
		cwd,
		env: verifyProcessEnv(cwd),
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

function isTreeseedWorkspaceRoot(root: string) {
	return existsSync(resolve(root, 'package.json')) && existsSync(resolve(root, 'packages'));
}

function workspacePackageSortWeight(pkg: WorkspacePackage) {
	const index = workspacePackageOrder.indexOf(pkg.relativeDir.split('/').pop() ?? '');
	return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function discoverWorkspaceVerifyActionPackages(root: string) {
	if (!isTreeseedWorkspaceRoot(root)) return [];
	const packagesRoot = resolve(root, 'packages');
	if (!existsSync(packagesRoot)) return [];
	return readdirSync(packagesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const dir = resolve(packagesRoot, entry.name);
			const manifest = readPackageManifest(resolve(dir, 'package.json'));
			if (!manifest?.name || typeof manifest.scripts?.['verify:action'] !== 'string') {
				return null;
			}
			return {
				name: manifest.name,
				dir,
				relativeDir: `packages/${entry.name}`,
				manifest,
			};
		})
		.filter((entry): entry is WorkspacePackage => Boolean(entry))
		.sort((left, right) => {
			const leftWeight = workspacePackageSortWeight(left);
			const rightWeight = workspacePackageSortWeight(right);
			if (leftWeight !== rightWeight) return leftWeight - rightWeight;
			return left.name.localeCompare(right.name);
		});
}

function readWorkflowJobNames(workflowPath: string): string[] {
	if (!existsSync(workflowPath)) return [];
	const source = readFileSync(workflowPath, 'utf8');
	const lines = source.split(/\r?\n/u);
	const jobsLine = lines.findIndex((line) => /^jobs:\s*$/u.test(line));
	if (jobsLine < 0) return [];
	const names: string[] = [];
	for (const line of lines.slice(jobsLine + 1)) {
		if (/^\S/u.test(line)) break;
		const match = /^  ([A-Za-z0-9_-]+):\s*$/u.exec(line);
		if (match) names.push(match[1]);
	}
	return names;
}

function createActArgs(eventName: string, workflowPath: string) {
	const image = process.env.TREESEED_VERIFY_ACT_UBUNTU_LATEST_IMAGE?.trim() || defaultActUbuntuLatestImage;
	const actStateRoot = process.env.TREESEED_VERIFY_ACT_STATE_ROOT?.trim() || '.treeseed/act';
	const args = [
		'act',
		eventName,
		'-W',
		workflowPath,
		'--concurrent-jobs',
		'1',
		'--artifact-server-path',
		`${actStateRoot}/artifacts`,
		'--cache-server-path',
		`${actStateRoot}/cache`,
		'--action-cache-path',
		`${actStateRoot}/actions`,
	];
	if (readWorkflowJobNames(resolve(workflowPath)).includes('verify')) {
		args.push('-j', 'verify');
	}
	if (image) {
		args.push('-P', `ubuntu-latest=${image}`);
	}
	return args;
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
	const workflowRoot = mkdtempSync(resolve(verifyTempRoot(options.workspaceRoot), 'treeseed-verify-act-'));
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
          node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync('package.json', 'utf8')); if (p.scripts) delete p.scripts.prepare; fs.writeFileSync('package.json', JSON.stringify(p, null, '\\t') + '\\n');"
          if test -f package-lock.json; then
            npm ci --workspaces=false
          else
            npm install --workspaces=false --no-audit --no-fund
          fi
          git checkout -- package.json || true

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

function runWithTemporaryEnv<T>(env: Record<string, string | undefined>, action: () => T) {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(env)) {
		previous.set(key, process.env[key]);
		if (typeof value === 'undefined') {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	try {
		return action();
	} finally {
		for (const [key, value] of previous) {
			if (typeof value === 'undefined') {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

function runWorkspaceActionVerification(input: {
	status: TreeseedVerifyDriverStatus;
	runCommand: (command: string, args: string[], cwd: string) => number;
	gh: string;
	write: (message: string, stream?: 'stdout' | 'stderr') => void;
}) {
	input.write('Treeseed verify: running root GitHub Actions workflow with gh act.');
	const rootStatus = input.runCommand(
		input.gh,
		createActArgs(input.status.eventName, '.github/workflows/verify.yml'),
		input.status.packageRoot,
	);
	if (rootStatus !== 0) {
		return rootStatus;
	}

	const packages = discoverWorkspaceVerifyActionPackages(input.status.packageRoot);
	if (packages.length === 0) {
		input.write('Treeseed verify: no package verify:action scripts found in workspace graph.');
		return 0;
	}

	input.write(`Treeseed verify: running package graph action verification for ${packages.map((pkg) => pkg.name).join(', ')}.`);
	for (const pkg of packages) {
		input.write(`Treeseed verify: ${pkg.name} package GitHub Actions workflow.`);
		const status = runWithTemporaryEnv({
			TREESEED_VERIFY_ACTION_SCOPE: 'single',
			TREESEED_VERIFY_PACKAGE_ISOLATED: '1',
		}, () => input.runCommand('npm', ['run', 'verify:action'], pkg.dir));
		if (status !== 0) {
			input.write(`Treeseed verify: ${pkg.name} package action verification failed.`, 'stderr');
			return status;
		}
	}

	return 0;
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
		const actionScope = process.env.TREESEED_VERIFY_ACTION_SCOPE?.trim();
		if (
			actionScope !== 'single' &&
			isTreeseedWorkspaceRoot(status.packageRoot)
		) {
			return runWorkspaceActionVerification({ status, runCommand, gh, write });
		}
		if (
			process.env.TREESEED_VERIFY_PACKAGE_ISOLATED !== '1' &&
			status.workspaceRoot &&
			status.localTreeseedSiblingDependencies.length > 0
		) {
			const workspaceAct = createWorkspaceActWorkflow({
				workspaceRoot: status.workspaceRoot,
				packageRoot: status.packageRoot,
				eventName: status.eventName,
				localTreeseedSiblingDependencies: status.localTreeseedSiblingDependencies,
			});
			return runCommand(gh, workspaceAct.args, workspaceAct.cwd);
		}
		return runCommand(gh, createActArgs(status.eventName, '.github/workflows/verify.yml'), status.packageRoot);
	}

	if (status.prefersDirectForLocalWorkspace) {
		return runCommand('npm', ['run', 'verify:direct'], status.packageRoot);
	}

	if (status.canUseAct) {
		return runCommand(gh, createActArgs(status.eventName, '.github/workflows/verify.yml'), status.packageRoot);
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
