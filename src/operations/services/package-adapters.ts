import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { workspacePackages, workspaceRoot } from './workspace-tools.ts';

export type TreeseedPackageKind = 'node-typescript' | 'beam-elixir-rust';

export type TreeseedPackageCommand = {
	label: string;
	command: string;
	args: string[];
	cwd: string;
};

export type TreeseedPackageAdapter = {
	id: string;
	name: string;
	kind: TreeseedPackageKind;
	dir: string;
	relativeDir: string;
	version: string | null;
	publishTarget: string | null;
	manifestPath: string | null;
	versionSource: string | null;
	verifyCommands: {
		fast: TreeseedPackageCommand | null;
		local: TreeseedPackageCommand | null;
		release: TreeseedPackageCommand | null;
	};
	artifacts: Array<{
		provider: 'npm' | 'docker';
		name: string;
		tags?: string[];
	}>;
	releaseChecks: Array<{
		kind: 'npm-pack-dry-run' | 'github-workflow' | 'docker-manifest';
		name: string;
		detail: string;
	}>;
	metadata: Record<string, unknown>;
};

type TreeseedPackageManifest = {
	id?: unknown;
	name?: unknown;
	kind?: unknown;
	versionSource?: unknown;
	image?: unknown;
	verify?: unknown;
	releaseGate?: unknown;
};

function readJsonFile(filePath: string) {
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function readPackageJsonVersion(filePath: string) {
	const packageJson = readJsonFile(filePath);
	return typeof packageJson?.version === 'string' ? packageJson.version : null;
}

export function readMixProjectVersion(filePath: string) {
	if (!existsSync(filePath)) return null;
	const source = readFileSync(filePath, 'utf8');
	const match = source.match(/\bversion:\s*"([^"]+)"/u);
	return match?.[1] ?? null;
}

function commandFromScript(dir: string, script: unknown, label: string): TreeseedPackageCommand | null {
	if (typeof script !== 'string' || !script.trim()) return null;
	const trimmed = script.trim();
	if (trimmed.startsWith('scripts/')) {
		return { label, command: 'bash', args: [trimmed], cwd: dir };
	}
	return { label, command: 'bash', args: ['-lc', trimmed], cwd: dir };
}

function nodeTypeScriptAdapter(pkg: ReturnType<typeof workspacePackages>[number]): TreeseedPackageAdapter {
	const scripts = pkg.packageJson?.scripts && typeof pkg.packageJson.scripts === 'object' && !Array.isArray(pkg.packageJson.scripts)
		? pkg.packageJson.scripts as Record<string, unknown>
		: {};
	const verifyLocal = typeof scripts['verify:local'] === 'string'
		? 'verify:local'
		: typeof scripts.verify === 'string'
			? 'verify'
			: typeof scripts['verify:action'] === 'string'
				? 'verify:action'
				: null;
	return {
		id: String(pkg.name),
		name: String(pkg.name),
		kind: 'node-typescript',
		dir: pkg.dir,
		relativeDir: pkg.relativeDir,
		version: typeof pkg.packageJson?.version === 'string' ? pkg.packageJson.version : null,
		publishTarget: 'npm',
		manifestPath: resolve(pkg.dir, 'package.json'),
		versionSource: resolve(pkg.dir, 'package.json'),
		verifyCommands: {
			fast: typeof scripts.verify === 'string' ? { label: 'verify', command: 'npm', args: ['run', 'verify'], cwd: pkg.dir } : null,
			local: verifyLocal ? { label: verifyLocal, command: 'npm', args: ['run', verifyLocal], cwd: pkg.dir } : null,
			release: typeof scripts['release:publish'] === 'string' ? { label: 'release:publish', command: 'npm', args: ['run', 'release:publish'], cwd: pkg.dir } : null,
		},
		artifacts: [{ provider: 'npm', name: String(pkg.name) }],
		releaseChecks: [
			{ kind: 'github-workflow', name: 'publish workflow', detail: '.github/workflows/publish.yml' },
			{ kind: 'npm-pack-dry-run', name: 'npm pack', detail: 'npm pack --dry-run' },
		],
		metadata: {
			scripts,
		},
	};
}

function treeseedPackageManifestPath(dir: string) {
	for (const fileName of ['treeseed.package.json', '.treeseed-package.json']) {
		const filePath = resolve(dir, fileName);
		if (existsSync(filePath)) return filePath;
	}
	return null;
}

function readTreeseedPackageManifest(dir: string): TreeseedPackageManifest | null {
	const filePath = treeseedPackageManifestPath(dir);
	return filePath ? readJsonFile(filePath) as TreeseedPackageManifest | null : null;
}

function beamPackageAdapter(root: string, dir: string): TreeseedPackageAdapter | null {
	const manifest = readTreeseedPackageManifest(dir);
	const hasMixProject = existsSync(resolve(dir, 'apps/api/mix.exs')) || existsSync(resolve(dir, 'mix.exs'));
	if (!manifest && !hasMixProject) return null;
	const kind = typeof manifest?.kind === 'string' ? manifest.kind : 'beam-elixir-rust';
	if (kind !== 'beam-elixir-rust') return null;
	const id = typeof manifest?.id === 'string' && manifest.id.trim()
		? manifest.id.trim()
		: relative(resolve(root, 'packages'), dir).replaceAll('\\', '/');
	const name = typeof manifest?.name === 'string' && manifest.name.trim() ? manifest.name.trim() : id;
	const versionSourceRel = typeof manifest?.versionSource === 'string' && manifest.versionSource.trim()
		? manifest.versionSource.trim()
		: existsSync(resolve(dir, 'apps/api/mix.exs'))
			? 'apps/api/mix.exs'
			: 'mix.exs';
	const versionSource = resolve(dir, versionSourceRel);
	const image = typeof manifest?.image === 'string' && manifest.image.trim()
		? manifest.image.trim()
		: id === 'treedb'
			? 'treeseed/treedb'
			: null;
	const verify = manifest?.verify && typeof manifest.verify === 'object' && !Array.isArray(manifest.verify)
		? manifest.verify as Record<string, unknown>
		: {};
	const fast = verify.fast ?? (existsSync(resolve(dir, 'scripts/test-treedb-fast.sh')) ? 'scripts/test-treedb-fast.sh' : null);
	const local = verify.local ?? (existsSync(resolve(dir, 'scripts/test-all.sh')) ? 'scripts/test-all.sh' : null);
	const releaseGate = manifest?.releaseGate ?? verify.release ?? (existsSync(resolve(dir, 'scripts/release-gate.sh')) ? 'scripts/release-gate.sh' : null);
	const version = readMixProjectVersion(versionSource);
	const shaTag = 'sha-<short-sha>';
	return {
		id,
		name,
		kind: 'beam-elixir-rust',
		dir,
		relativeDir: relative(root, dir).replaceAll('\\', '/'),
		version,
		publishTarget: image,
		manifestPath: treeseedPackageManifestPath(dir),
		versionSource,
		verifyCommands: {
			fast: commandFromScript(dir, fast, 'fast'),
			local: commandFromScript(dir, local, 'local'),
			release: commandFromScript(dir, releaseGate, 'release'),
		},
		artifacts: image ? [{ provider: 'docker', name: image, tags: version ? [version, shaTag] : [shaTag] }] : [],
		releaseChecks: image
			? [{ kind: 'docker-manifest', name: 'Docker image manifest', detail: `${image}:${version ?? '<version>'}` }]
			: [],
		metadata: {
			hasCargo: existsSync(resolve(dir, 'Cargo.toml')),
			hasDockerfile: existsSync(resolve(dir, 'Dockerfile')),
			versionSource: versionSourceRel,
		},
	};
}

export function discoverTreeseedPackageAdapters(root = workspaceRoot()): TreeseedPackageAdapter[] {
	const adapters = new Map<string, TreeseedPackageAdapter>();
	for (const pkg of workspacePackages(root)) {
		if (typeof pkg.name === 'string' && pkg.name.startsWith('@treeseed/')) {
			adapters.set(pkg.name, nodeTypeScriptAdapter(pkg));
		}
	}
	const packagesDir = resolve(root, 'packages');
	for (const name of ['treedb']) {
		const dir = resolve(packagesDir, name);
		if (!existsSync(dir)) continue;
		const adapter = beamPackageAdapter(root, dir);
		if (adapter) adapters.set(adapter.id, adapter);
	}
	return [...adapters.values()].sort((left, right) => {
		if (left.kind !== right.kind) return left.kind === 'node-typescript' ? -1 : 1;
		return left.id.localeCompare(right.id);
	});
}

export function findTreeseedPackageAdapter(root: string, idOrName: string) {
	return discoverTreeseedPackageAdapters(root).find((adapter) => adapter.id === idOrName || adapter.name === idOrName) ?? null;
}

export function packageAdapterPlanSummary(root = workspaceRoot()) {
	return discoverTreeseedPackageAdapters(root).map((adapter) => ({
		id: adapter.id,
		name: adapter.name,
		kind: adapter.kind,
		path: adapter.relativeDir,
		version: adapter.version,
		publishTarget: adapter.publishTarget,
		verify: Object.fromEntries(Object.entries(adapter.verifyCommands).map(([key, command]) => [
			key,
			command ? `${command.command} ${command.args.join(' ')}` : null,
		])),
		artifacts: adapter.artifacts,
		releaseChecks: adapter.releaseChecks,
	}));
}
