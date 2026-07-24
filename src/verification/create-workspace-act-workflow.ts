import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as childProcess from 'node:child_process';
import { basename, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createManagedToolEnv, resolveToolBinary } from '../entrypoints/runtime/managed-dependencies.ts';
import { LocalWorkspaceContext, PackageManifest, VerifyDriver, VerifyDriverOptions, VerifyDriverStatus, check, createActArgs, readPackageManifest } from './verify-driver.ts';

export function createWorkspaceActWorkflow(options: {
	workspaceRoot: string;
	packageRoot: string;
	eventName: string;
	localSiblingDependencies: string[];
}) {
	const relativePackageRoot = relative(options.workspaceRoot, options.packageRoot).replace(/\\/g, '/');
	const siblingLinkCommands = options.localSiblingDependencies
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
	const siblingPreparationCommands = options.localSiblingDependencies
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

export function findWorkspaceRoot(packageRoot: string) {
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

export function resolveLocalWorkspaceContext(packageRoot: string, extraSiblingDependencies: readonly string[] = []): LocalWorkspaceContext {
	const currentManifest = readPackageManifest(resolve(packageRoot, 'package.json'));
	const currentPackageName = typeof currentManifest?.name === 'string' ? currentManifest.name : null;
	const workspace = findWorkspaceRoot(packageRoot);

	if (!workspace) {
		return {
			workspaceRoot: null,
			currentPackageName,
			localPackageNames: [],
			localSiblingDependencies: [],
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
			localPackageNames: [],
			localSiblingDependencies: [],
		};
	}

	const localPackageNames = localPackages
		.map((entry) => entry.manifest.name as string)
		.filter((name) => name.startsWith('@treeseed/'))
		.sort();
	const localPackageSet = new Set(localPackageNames);
	const declaredDependencies = {
		...(currentPackage.manifest.dependencies ?? {}),
		...(currentPackage.manifest.devDependencies ?? {}),
		...(currentPackage.manifest.peerDependencies ?? {}),
	};
	const declaredLocalSiblingDependencies = Object.keys(declaredDependencies)
		.filter((name) => name.startsWith('@treeseed/'))
		.filter((name) => localPackageSet.has(name))
		.sort();
	const extraLocalSiblingDependencies = extraSiblingDependencies
		.filter((name) => name.startsWith('@treeseed/'))
		.filter((name) => localPackageSet.has(name))
		.sort();
	const localSiblingDependencies = [
		...declaredLocalSiblingDependencies,
		...extraLocalSiblingDependencies.filter((name) => !declaredLocalSiblingDependencies.includes(name)),
	];

	return {
		workspaceRoot: workspace.workspaceRoot,
		currentPackageName: currentPackage.manifest.name ?? currentPackageName,
		localPackageNames,
		localSiblingDependencies,
	};
}

export function getVerifyDriverStatus(options: VerifyDriverOptions = {}): VerifyDriverStatus {
	const packageRoot = resolve(options.packageRoot ?? process.cwd());
	const workflowPath = resolve(packageRoot, '.github', 'workflows', 'verify.yml');
	const driver = options.driver ?? (process.env.TREESEED_VERIFY_DRIVER as VerifyDriver | undefined) ?? 'auto';
	const eventName = options.eventName ?? process.env.TREESEED_VERIFY_EVENT ?? 'workflow_dispatch';
	const inGitHubActions = process.env.GITHUB_ACTIONS === 'true';
	const workflowPresent = existsSync(workflowPath);
	const workspace = resolveLocalWorkspaceContext(packageRoot, options.localExtraSiblingDependencies ?? []);
	const checkCommand = options.checkCommand ?? check;
	const gh = options.checkCommand ? 'gh' : (resolveToolBinary('gh') ?? 'gh');
	const ghAct = checkCommand(gh, ['act', '--version'], packageRoot);
	const docker = checkCommand('docker', ['info'], packageRoot);
	const prefersDirectForLocalWorkspace =
		!inGitHubActions &&
		driver === 'auto' &&
		workspace.localSiblingDependencies.length > 0;

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
		localPackageNames: workspace.localPackageNames,
		localSiblingDependencies: workspace.localSiblingDependencies,
		prefersDirectForLocalWorkspace,
	};
}
