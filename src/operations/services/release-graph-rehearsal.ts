import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createTreeseedManagedToolEnv, resolveTreeseedToolBinary } from '../../managed-dependencies.ts';
import { discoverTreeseedPackageAdapters, type TreeseedPackageAdapter } from './package-adapters.ts';
import { classifyTreeseedGitMode, runTreeseedGitText } from './git-runner.ts';
import { sortWorkspacePackages, workspacePackages } from './workspace-tools.ts';

export type ReleaseGraphNodeKind = 'root' | 'node-package' | 'image-service' | 'hosted-service' | 'manifest-only';
export type ReleaseGraphEdgeKind = 'npm-dependency' | 'dev-dependency' | 'peer-dependency' | 'artifact-consumer' | 'hosting-image-consumer' | 'verification-prerequisite';
export type ReleaseGraphVerifyDriver = 'auto' | 'local' | 'action';

export type ReleaseGraphNode = {
	id: string;
	name: string;
	kind: ReleaseGraphNodeKind;
	packageKind: string;
	path: string;
	relativePath: string;
	version: string | null;
	publishTarget: string | null;
};

export type ReleaseGraphEdge = {
	from: string;
	to: string;
	kind: ReleaseGraphEdgeKind;
	reason: string;
};

export type ReleaseGraphProofArtifact = {
	packageId: string;
	provider: 'npm' | 'docker' | 'beam';
	proofType: 'tarball' | 'docker-build' | 'verify-script';
	path?: string;
	imageRef?: string;
	command?: string;
	status: 'passed' | 'failed' | 'skipped';
};

export type ReleaseGraphActionCheck = {
	packageId: string;
	workflow: string;
	driver: 'gh-act';
	status: 'passed' | 'failed' | 'skipped';
	detail?: string;
};

export type ReleaseGraphFailure = {
	code: string;
	scope: string;
	message: string;
	details?: Record<string, unknown> | null;
};

export type ReleaseGraphProof = {
	schemaVersion: 1;
	policyVersion: string;
	proofId: string;
	status: 'passed' | 'failed';
	checkedAt: string;
	root: { path: string; sha: string | null };
	graph: {
		nodes: ReleaseGraphNode[];
		edges: ReleaseGraphEdge[];
		order: string[];
	};
	artifacts: ReleaseGraphProofArtifact[];
	verifyDriver: ReleaseGraphVerifyDriver;
	actionChecks: ReleaseGraphActionCheck[];
	failures: ReleaseGraphFailure[];
};

export type ReleaseGraphRehearsalOptions = {
	root: string;
	selectedPackageNames?: string[];
	verifyDriver?: ReleaseGraphVerifyDriver;
	strict?: boolean;
	keepWorkspace?: boolean;
	write?: (line: string, stream?: 'stdout' | 'stderr') => void;
	env?: NodeJS.ProcessEnv;
};

const POLICY_VERSION = 'release-graph-rehearsal-v1';
const INTERNAL_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const;
const IGNORED_COPY_SEGMENTS = new Set([
	'.git',
	'.treeseed',
	'.wrangler',
	'.astro',
	'_build',
	'coverage',
	'deps',
	'dist',
	'node_modules',
	'target',
]);
const STAGED_TARBALL_DIR = 'treeseed-release-tarballs';

function runGit(args: string[], cwd: string) {
	return runTreeseedGitText(args, {
		cwd,
		mode: classifyTreeseedGitMode(args),
		timeoutMs: 120000,
		maxBuffer: 1024 * 1024 * 8,
	}).trim();
}

function safeGitHead(cwd: string) {
	try {
		return runGit(['rev-parse', 'HEAD'], cwd);
	} catch {
		return null;
	}
}

function readJson(filePath: string) {
	return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function writeJson(filePath: string, value: Record<string, unknown>) {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function packageScripts(dir: string) {
	try {
		const packageJson = readJson(resolve(dir, 'package.json'));
		return packageJson.scripts && typeof packageJson.scripts === 'object' && !Array.isArray(packageJson.scripts)
			? packageJson.scripts as Record<string, unknown>
			: {};
	} catch {
		return {};
	}
}

function commandToString(command: string, args: string[]) {
	return [command, ...args].join(' ');
}

function runCommand(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; capture?: boolean }) {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: options.env,
		stdio: options.capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
		timeout: options.timeoutMs,
		shell: process.platform === 'win32',
	});
	if (result.status !== 0) {
		const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
		throw new Error([
			`${commandToString(command, args)} failed in ${options.cwd}`,
			result.error?.message,
			output,
		].filter(Boolean).join('\n'));
	}
	return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
}

function positiveIntegerEnv(env: NodeJS.ProcessEnv, name: string) {
	const raw = env[name] ?? process.env[name];
	if (raw == null || raw === '') return null;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function releaseGraphNpmEnv(root: string, env: NodeJS.ProcessEnv) {
	const cacheHome = resolve(root, '.treeseed', 'cache');
	const npmCache = resolve(cacheHome, 'npm');
	const toolsHome = resolve(root, '.treeseed', 'tools');
	const ghConfigDir = resolve(toolsHome, 'gh-config');
	mkdirSync(npmCache, { recursive: true });
	mkdirSync(ghConfigDir, { recursive: true });
	return {
		...process.env,
		...env,
		XDG_CACHE_HOME: env.XDG_CACHE_HOME ?? process.env.XDG_CACHE_HOME ?? cacheHome,
		npm_config_cache: env.npm_config_cache ?? env.NPM_CONFIG_CACHE ?? process.env.npm_config_cache ?? process.env.NPM_CONFIG_CACHE ?? npmCache,
		NPM_CONFIG_CACHE: env.NPM_CONFIG_CACHE ?? env.npm_config_cache ?? process.env.NPM_CONFIG_CACHE ?? process.env.npm_config_cache ?? npmCache,
		TREESEED_TOOLS_HOME: env.TREESEED_TOOLS_HOME ?? process.env.TREESEED_TOOLS_HOME ?? toolsHome,
		TREESEED_GH_CONFIG_DIR: env.TREESEED_GH_CONFIG_DIR ?? process.env.TREESEED_GH_CONFIG_DIR ?? ghConfigDir,
		npm_config_audit: env.npm_config_audit ?? process.env.npm_config_audit ?? 'false',
		npm_config_fund: env.npm_config_fund ?? process.env.npm_config_fund ?? 'false',
	};
}

function safeEnvSegment(value: string) {
	return value.replaceAll(/[^A-Za-z0-9._-]/gu, '_');
}

function releaseGraphManifestPackageEnv(root: string, adapter: TreeseedPackageAdapter, env: NodeJS.ProcessEnv) {
	const stateRoot = resolve(root, '.treeseed', 'tmp', 'release-graph', safeEnvSegment(adapter.id));
	const cacheRoot = resolve(root, '.treeseed', 'cache', 'release-graph', safeEnvSegment(adapter.id));
	const tempDir = resolve(stateRoot, 'tmp');
	const cargoTargetDir = resolve(stateRoot, 'cargo-target');
	const rustlerTargetDir = resolve(stateRoot, 'rustler-target');
	const cargoHome = resolve(cacheRoot, 'cargo');
	const mixHome = resolve(cacheRoot, 'mix');
	const hexHome = resolve(cacheRoot, 'hex');
	const trivyCacheDir = resolve(cacheRoot, 'trivy');
	for (const dir of [tempDir, cargoTargetDir, rustlerTargetDir, cargoHome, mixHome, hexHome, trivyCacheDir]) {
		mkdirSync(dir, { recursive: true });
	}
	return {
		...env,
		TMPDIR: env.TMPDIR ?? tempDir,
		TMP: env.TMP ?? tempDir,
		TEMP: env.TEMP ?? tempDir,
		CARGO_HOME: env.CARGO_HOME ?? cargoHome,
		CARGO_TARGET_DIR: env.CARGO_TARGET_DIR ?? cargoTargetDir,
		RUSTLER_TARGET_DIR: env.RUSTLER_TARGET_DIR ?? rustlerTargetDir,
		TREEDX_BUILD_TMP_DIR: env.TREEDX_BUILD_TMP_DIR ?? tempDir,
		MIX_HOME: env.MIX_HOME ?? mixHome,
		HEX_HOME: env.HEX_HOME ?? hexHome,
		TRIVY_CACHE_DIR: env.TRIVY_CACHE_DIR ?? trivyCacheDir,
	};
}

function releaseGraphTempBase(root: string) {
	const configured = process.env.TREESEED_RELEASE_GRAPH_TMPDIR;
	const base = configured ? resolve(configured) : resolve(tmpdir(), 'treeseed', 'release-graph');
	mkdirSync(base, { recursive: true });
	return base;
}

function packageActionTempBase(packageDir: string) {
	const workspaceRoot = workspacePackages(dirname(packageDir)).length > 0 ? dirname(packageDir) : dirname(dirname(packageDir));
	const base = resolve(workspaceRoot, '.treeseed', 'tmp', 'actions', safeEnvSegment(basename(packageDir)));
	mkdirSync(base, { recursive: true });
	return base;
}

function ensureIgnoreFileIncludesStagedTarballs(filePath: string) {
	const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
	const entries = [
		`!${STAGED_TARBALL_DIR}/`,
		`!${STAGED_TARBALL_DIR}/*.tgz`,
	];
	const missing = entries.filter((entry) => !existing.split(/\r?\n/u).includes(entry));
	if (missing.length === 0) return;
	const suffix = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
	writeFileSync(filePath, `${existing}${suffix}${missing.join('\n')}\n`, 'utf8');
}

function ensureIgnoreFilesIncludeStagedTarballs(packageDir: string) {
	ensureIgnoreFileIncludesStagedTarballs(resolve(packageDir, '.gitignore'));
	ensureIgnoreFileIncludesStagedTarballs(resolve(packageDir, '.npmignore'));
}

function copyWorkspace(root: string) {
	const tempParent = mkdtempSync(join(releaseGraphTempBase(root), 'treeseed-release-graph-'));
	const tempRoot = join(tempParent, 'workspace');
	cpSync(root, tempRoot, {
		recursive: true,
		filter: (source) => {
			const rel = relative(root, source);
			if (!rel) return true;
			return !rel.split(/[\\/]+/u).some((segment) => IGNORED_COPY_SEGMENTS.has(segment));
		},
	});
	return { tempParent, tempRoot };
}

function adapterNode(root: string, adapter: TreeseedPackageAdapter): ReleaseGraphNode {
	const type = typeof adapter.metadata.type === 'string' ? adapter.metadata.type : null;
	const docker = adapter.artifacts.some((artifact) => artifact.provider === 'docker');
	const kind: ReleaseGraphNodeKind = adapter.kind === 'beam-elixir-rust' || type === 'image-service' || docker
		? 'image-service'
		: adapter.kind === 'node-typescript' ? 'node-package' : 'manifest-only';
	return {
		id: adapter.id,
		name: adapter.name,
		kind,
		packageKind: adapter.kind,
		path: adapter.dir,
		relativePath: relative(root, adapter.dir).replaceAll('\\', '/'),
		version: adapter.version,
		publishTarget: adapter.publishTarget,
	};
}

function internalDependencyEdges(root: string, adapters: TreeseedPackageAdapter[]) {
	const byName = new Map<string, TreeseedPackageAdapter>();
	const byId = new Map<string, TreeseedPackageAdapter>();
	for (const adapter of adapters) {
		byName.set(adapter.name, adapter);
		byId.set(adapter.id, adapter);
	}
	const edges: ReleaseGraphEdge[] = [];
	for (const adapter of adapters) {
		if (!existsSync(resolve(adapter.dir, 'package.json'))) continue;
		const packageJson = readJson(resolve(adapter.dir, 'package.json'));
		for (const field of INTERNAL_FIELDS) {
			const values = packageJson[field];
			if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
			for (const dependencyName of Object.keys(values as Record<string, unknown>)) {
				const dependency = byName.get(dependencyName) ?? byId.get(dependencyName);
				if (!dependency) continue;
				const kind: ReleaseGraphEdgeKind = field === 'devDependencies'
					? 'dev-dependency'
					: field === 'peerDependencies' ? 'peer-dependency' : 'npm-dependency';
				edges.push({
					from: dependency.id,
					to: adapter.id,
					kind,
					reason: `${adapter.id} declares ${dependencyName} in ${field}.`,
				});
			}
		}
	}
	if (byId.has('treedx') && byId.has('@treeseed/api')) {
		edges.push({
			from: 'treedx',
			to: '@treeseed/api',
			kind: 'hosting-image-consumer',
			reason: '@treeseed/api production hosting consumes the released TreeDX image through TREESEED_PUBLIC_TREEDX_IMAGE_REF.',
		});
	}
	return edges;
}

function topologicalOrder(root: string, adapters: TreeseedPackageAdapter[], edges: ReleaseGraphEdge[]) {
	const selected = new Set(adapters.map((adapter) => adapter.id));
	const workspaceOrder = new Map(sortWorkspacePackages(workspacePackages(root)).map((pkg, index) => [pkg.name, index]));
	const fallbackOrder = new Map(['@treeseed/sdk', '@treeseed/ui', '@treeseed/core', '@treeseed/admin', '@treeseed/cli', '@treeseed/agent', 'treedx', '@treeseed/api'].map((id, index) => [id, index]));
	const pending = new Map(adapters.map((adapter) => [adapter.id, new Set<string>()]));
	const outgoing = new Map(adapters.map((adapter) => [adapter.id, [] as string[]]));
	for (const edge of edges) {
		if (!selected.has(edge.from) || !selected.has(edge.to)) continue;
		pending.get(edge.to)?.add(edge.from);
		outgoing.get(edge.from)?.push(edge.to);
	}
	const sortedAdapters = [...adapters].sort((left, right) => {
		const leftOrder = workspaceOrder.get(left.name) ?? fallbackOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
		const rightOrder = workspaceOrder.get(right.name) ?? fallbackOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
		if (leftOrder !== rightOrder) return leftOrder - rightOrder;
		return left.id.localeCompare(right.id);
	});
	const ready = sortedAdapters.filter((adapter) => (pending.get(adapter.id)?.size ?? 0) === 0).map((adapter) => adapter.id);
	const order: string[] = [];
	while (ready.length > 0) {
		const id = ready.shift()!;
		order.push(id);
		for (const consumer of outgoing.get(id) ?? []) {
			const deps = pending.get(consumer);
			deps?.delete(id);
			if (deps && deps.size === 0 && !order.includes(consumer) && !ready.includes(consumer)) {
				ready.push(consumer);
				ready.sort((left, right) => {
					const leftAdapter = adapters.find((adapter) => adapter.id === left)!;
					const rightAdapter = adapters.find((adapter) => adapter.id === right)!;
					return sortedAdapters.indexOf(leftAdapter) - sortedAdapters.indexOf(rightAdapter);
				});
			}
		}
	}
	if (order.length !== adapters.length) {
		const cyclic = adapters.map((adapter) => adapter.id).filter((id) => !order.includes(id));
		throw new Error(`Release graph contains a cycle or unresolved dependency: ${cyclic.join(', ')}`);
	}
	return order;
}

export function buildReleaseGraph(root: string, selectedPackageNames: string[] = []) {
	const all = discoverTreeseedPackageAdapters(root);
	const allEdges = internalDependencyEdges(root, all);
	const selected = new Set(selectedPackageNames);
	const selectedIds = new Set<string>();
	if (selected.size > 0) {
		for (const adapter of all) {
			if (selected.has(adapter.id) || selected.has(adapter.name)) {
				selectedIds.add(adapter.id);
			}
		}
		for (const name of selected) {
			if (!selectedIds.has(name) && !all.some((adapter) => adapter.name === name || adapter.id === name)) {
				throw new Error(`Release graph package ${name} was not discovered.`);
			}
		}
		const changed = { value: true };
		while (changed.value) {
			changed.value = false;
			for (const edge of allEdges) {
				if (selectedIds.has(edge.to) && !selectedIds.has(edge.from)) {
					selectedIds.add(edge.from);
					changed.value = true;
				}
			}
		}
	}
	const adapters = selected.size === 0 ? all : all.filter((adapter) => selectedIds.has(adapter.id));
	const included = new Set(adapters.map((adapter) => adapter.id));
	const edges = allEdges.filter((edge) => included.has(edge.from) && included.has(edge.to));
	const order = topologicalOrder(root, adapters, edges);
	return {
		nodes: adapters.map((adapter) => adapterNode(root, adapter)),
		edges,
		order,
		adapters,
	};
}

function releaseGraphTarballVersion(tarballPath: string) {
	const packageJson = readJson(resolve(dirname(tarballPath), 'package.json'));
	const version = typeof packageJson.version === 'string' ? packageJson.version : null;
	if (!version) throw new Error(`Could not determine package version for ${tarballPath}.`);
	return version;
}

function rewriteInternalDependencies(packageDir: string, tarballs: Map<string, string>, mode: 'file' | 'version') {
	const packageJsonPath = resolve(packageDir, 'package.json');
	if (!existsSync(packageJsonPath)) return;
	const packageJson = readJson(packageJsonPath);
	let changed = false;
	const stagedTarballDir = resolve(packageDir, STAGED_TARBALL_DIR);
	for (const field of INTERNAL_FIELDS) {
		const values = packageJson[field];
		if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
		for (const [dependencyName, tarballPath] of tarballs.entries()) {
			if (!(dependencyName in values)) continue;
			if (mode === 'file') {
				mkdirSync(stagedTarballDir, { recursive: true });
				const stagedTarballName = basename(tarballPath);
				const stagedTarballPath = resolve(stagedTarballDir, stagedTarballName);
				cpSync(tarballPath, stagedTarballPath);
				ensureIgnoreFilesIncludeStagedTarballs(packageDir);
				(values as Record<string, unknown>)[dependencyName] = `file:${STAGED_TARBALL_DIR}/${stagedTarballName}`;
			} else {
				(values as Record<string, unknown>)[dependencyName] = releaseGraphTarballVersion(tarballPath);
			}
			changed = true;
		}
	}
	if (changed) writeJson(packageJsonPath, packageJson);
}

function packNodePackage(adapter: TreeseedPackageAdapter, tempRoot: string, tarballs: Map<string, string>, env: NodeJS.ProcessEnv) {
	const packageDir = resolve(tempRoot, adapter.relativeDir);
	rewriteInternalDependencies(packageDir, tarballs, 'file');
	runCommand('npm', ['install', '--package-lock-only', '--ignore-scripts', '--workspaces=false', '--no-audit', '--no-fund'], {
		cwd: packageDir,
		env,
		timeoutMs: 300000,
	});
	runCommand('npm', ['ci', '--ignore-scripts', '--workspaces=false', '--no-audit', '--no-fund'], {
		cwd: packageDir,
		env,
		timeoutMs: 600000,
	});
	const scripts = packageScripts(packageDir);
	if (typeof scripts['build:dist'] === 'string') {
		runCommand('npm', ['run', 'build:dist'], { cwd: packageDir, env, timeoutMs: 600000 });
	}
	try {
		rewriteInternalDependencies(packageDir, tarballs, 'version');
		const output = runCommand('npm', ['pack', '--json', '--ignore-scripts'], { cwd: packageDir, env, timeoutMs: 300000, capture: true });
		const parsed = parseNpmPackJson(output, adapter.id);
		const filename = parsed[0]?.filename;
		if (!filename) throw new Error(`${adapter.id} npm pack did not report a tarball filename.`);
		const tarball = resolve(packageDir, filename);
		return tarball;
	} finally {
		rewriteInternalDependencies(packageDir, tarballs, 'file');
	}
}

function parseNpmPackJson(output: string, packageId: string) {
	const starts = [...output.matchAll(/\[/gu)].map((match) => match.index ?? -1).filter((index) => index >= 0);
	const ends = [...output.matchAll(/\]/gu)].map((match) => match.index ?? -1).filter((index) => index >= 0).reverse();
	for (const start of starts) {
		for (const end of ends) {
			if (end <= start) continue;
			try {
				const parsed = JSON.parse(output.slice(start, end + 1));
				if (Array.isArray(parsed)) return parsed as Array<{ filename?: string }>;
			} catch {
				// Keep scanning; build tools may write bracketed log prefixes before npm's JSON.
			}
		}
	}
	throw new Error(`${packageId} npm pack did not emit a JSON array.`);
}

function verifyNodePackageAction(adapter: TreeseedPackageAdapter, packageDir: string, driver: ReleaseGraphVerifyDriver, env: NodeJS.ProcessEnv): ReleaseGraphActionCheck {
	const scripts = packageScripts(packageDir);
	if (typeof scripts['verify:action'] !== 'string') {
		return { packageId: adapter.id, workflow: '.github/workflows/verify.yml', driver: 'gh-act', status: 'skipped', detail: 'verify:action script missing.' };
	}
	if (driver === 'local') {
		return { packageId: adapter.id, workflow: '.github/workflows/verify.yml', driver: 'gh-act', status: 'skipped', detail: 'verify driver is local.' };
	}
	const actionTemp = packageActionTempBase(packageDir);
	const managedEnv = {
		...createTreeseedManagedToolEnv(env),
		TMPDIR: actionTemp,
		TMP: actionTemp,
		TEMP: actionTemp,
		TREESEED_VERIFY_ACTION_SCOPE: 'single',
		TREESEED_VERIFY_PACKAGE_ISOLATED: '1',
	};
	const gh = resolveTreeseedToolBinary('gh', { env: managedEnv }) ?? 'gh';
	const version = spawnSync(gh, ['act', '--version'], { cwd: packageDir, env: managedEnv, stdio: 'pipe', encoding: 'utf8' });
	const docker = spawnSync('docker', ['info'], { cwd: packageDir, env: managedEnv, stdio: 'pipe', encoding: 'utf8' });
	if (version.status !== 0 || docker.status !== 0) {
		if (driver === 'action') {
			throw new Error(`${adapter.id} requires gh act and Docker for verify:action.`);
		}
		return { packageId: adapter.id, workflow: '.github/workflows/verify.yml', driver: 'gh-act', status: 'skipped', detail: 'gh act or Docker unavailable.' };
	}
	runCommand('npm', ['run', 'verify:action'], { cwd: packageDir, env: managedEnv, timeoutMs: 900000 });
	return { packageId: adapter.id, workflow: '.github/workflows/verify.yml', driver: 'gh-act', status: 'passed' };
}

function manifestPackageTimeoutMs(adapter: TreeseedPackageAdapter, strict: boolean, env: NodeJS.ProcessEnv) {
	const configured = positiveIntegerEnv(env, 'TREESEED_RELEASE_GRAPH_MANIFEST_TIMEOUT_MS');
	if (configured != null) return configured;
	const packageSpecific = positiveIntegerEnv(
		env,
		`TREESEED_RELEASE_GRAPH_${adapter.id.replaceAll(/[^A-Za-z0-9]/gu, '_').toUpperCase()}_TIMEOUT_MS`,
	);
	if (packageSpecific != null) return packageSpecific;
	const packageType = typeof adapter.metadata.type === 'string' ? adapter.metadata.type : null;
	const hasDockerArtifact = adapter.artifacts.some((artifact) => artifact.provider === 'docker');
	const imageService = adapter.kind === 'beam-elixir-rust' || packageType === 'image-service' || hasDockerArtifact;
	if (imageService && strict) return 60 * 60 * 1000;
	if (imageService) return 30 * 60 * 1000;
	return 15 * 60 * 1000;
}

function verifyManifestPackage(adapter: TreeseedPackageAdapter, tempRoot: string, strict: boolean, env: NodeJS.ProcessEnv) {
	const packageDir = resolve(tempRoot, adapter.relativeDir);
	const command = strict ? adapter.verifyCommands.release ?? adapter.verifyCommands.local : adapter.verifyCommands.local ?? adapter.verifyCommands.fast;
	if (!command) {
		throw new Error(`${adapter.id} is missing a manifest verification command.`);
	}
	runCommand(command.command, command.args, { cwd: packageDir, env, timeoutMs: manifestPackageTimeoutMs(adapter, strict, env) });
	return commandToString(command.command, command.args);
}

function imageRefFor(adapter: TreeseedPackageAdapter) {
	if (adapter.id !== 'treedx') return null;
	return adapter.version && /^\d+\.\d+\.\d+$/u.test(adapter.version) ? `treeseed/treedx:${adapter.version}` : null;
}

function proofKey(value: unknown) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function runReleaseGraphRehearsal(options: ReleaseGraphRehearsalOptions): ReleaseGraphProof {
	const root = resolve(options.root);
	const env = releaseGraphNpmEnv(root, options.env ?? process.env);
	const verifyDriver = options.verifyDriver ?? 'auto';
	const strict = options.strict !== false;
	const graph = buildReleaseGraph(root, options.selectedPackageNames ?? []);
	const failures: ReleaseGraphFailure[] = [];
	const artifacts: ReleaseGraphProofArtifact[] = [];
	const actionChecks: ReleaseGraphActionCheck[] = [];
	const tarballs = new Map<string, string>();
	let tempParent: string | null = null;

	try {
		const copied = copyWorkspace(root);
		tempParent = copied.tempParent;
		const adaptersById = new Map(graph.adapters.map((adapter) => [adapter.id, adapter]));
		for (const id of graph.order) {
			const adapter = adaptersById.get(id);
			if (!adapter) continue;
			options.write?.(`[release-candidate][graph] Rehearsing ${id}.`);
			try {
				if (adapter.kind === 'node-typescript') {
					const tarball = packNodePackage(adapter, copied.tempRoot, tarballs, env);
					tarballs.set(adapter.name, tarball);
					tarballs.set(adapter.id, tarball);
					artifacts.push({ packageId: adapter.id, provider: 'npm', proofType: 'tarball', path: tarball, status: 'passed' });
					actionChecks.push(verifyNodePackageAction(adapter, resolve(copied.tempRoot, adapter.relativeDir), verifyDriver, env));
				} else {
					const command = verifyManifestPackage(adapter, copied.tempRoot, strict, releaseGraphManifestPackageEnv(root, adapter, env));
					artifacts.push({ packageId: adapter.id, provider: adapter.id === 'treedx' ? 'docker' : 'beam', proofType: 'verify-script', command, imageRef: imageRefFor(adapter) ?? undefined, status: 'passed' });
				}
			} catch (error) {
				failures.push({
					code: 'release_graph_node_failed',
					scope: id,
					message: `${id} failed local release graph rehearsal.`,
					details: { error: error instanceof Error ? error.message : String(error) },
				});
				artifacts.push({ packageId: id, provider: adapter.kind === 'node-typescript' ? 'npm' : 'beam', proofType: adapter.kind === 'node-typescript' ? 'tarball' : 'verify-script', status: 'failed' });
				break;
			}
		}
	} finally {
		if (tempParent && !options.keepWorkspace) {
			rmSync(tempParent, { recursive: true, force: true });
		} else if (tempParent) {
			options.write?.(`[release-candidate][graph] Kept rehearsal workspace ${tempParent}.`);
		}
	}

	const keyInput = {
		policyVersion: POLICY_VERSION,
		rootSha: safeGitHead(root),
		order: graph.order,
		nodes: graph.nodes.map((node) => ({ id: node.id, version: node.version, publishTarget: node.publishTarget })),
		heads: Object.fromEntries(graph.adapters.map((adapter) => [adapter.id, safeGitHead(adapter.dir)])),
		verifyDriver,
		strict,
	};
	const proofId = proofKey(keyInput);
	return {
		schemaVersion: 1,
		policyVersion: POLICY_VERSION,
		proofId,
		status: failures.length === 0 ? 'passed' : 'failed',
		checkedAt: new Date().toISOString(),
		root: { path: root, sha: safeGitHead(root) },
		graph: { nodes: graph.nodes, edges: graph.edges, order: graph.order },
		artifacts,
		verifyDriver,
		actionChecks,
		failures,
	};
}
