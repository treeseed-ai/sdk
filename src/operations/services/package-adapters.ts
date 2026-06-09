import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
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
	repository?: unknown;
	verify?: unknown;
	releaseGate?: unknown;
	developmentImages?: unknown;
};

export type TreeseedPackageDevelopmentImagePlan = {
	package: {
		id: string;
		name: string;
		path: string;
		kind: TreeseedPackageKind;
		version: string | null;
		publishTarget: string | null;
		metadata: Record<string, unknown>;
	};
	repository: string;
	workflow: string;
	branch: string;
	refs: {
		imageName: string;
		branch: string;
		branchSlug: string;
		sha: string;
		shortSha: string;
		immutableTag: string;
		movingTag: string | null;
		imageRef: string;
		movingImageRef: string | null;
		archImageRefs: string[];
	};
	hosting: {
		app: string;
		environment: string;
		overrideEnvVar: string;
		override: Record<string, string>;
		command: string;
	} | null;
};

function readJsonFile(filePath: string) {
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function readStructuredFile(filePath: string) {
	try {
		const raw = readFileSync(filePath, 'utf8');
		return filePath.endsWith('.yaml') || filePath.endsWith('.yml')
			? (parseYaml(raw) as Record<string, unknown>)
			: JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function readPackageJsonVersion(filePath: string) {
	const packageJson = readJsonFile(filePath);
	return typeof packageJson?.version === 'string' ? packageJson.version : null;
}

function normalizeGitHubRepositorySlug(value: unknown) {
	const raw = typeof value === 'string'
		? value
		: value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>).url
			: null;
	if (typeof raw !== 'string' || !raw.trim()) return null;
	const normalized = raw
		.trim()
		.replace(/^git\+/u, '')
		.replace(/^ssh:\/\/git@github\.com[:/]/u, '')
		.replace(/^git@github\.com:/u, '')
		.replace(/^https:\/\/github\.com\//u, '')
		.replace(/\.git$/u, '')
		.replace(/\/$/u, '');
	return /^[^/\s]+\/[^/\s]+$/u.test(normalized) ? normalized : null;
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
	const repository = normalizeGitHubRepositorySlug(pkg.packageJson?.repository);
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
			...(repository ? { repository } : {}),
			scripts,
		},
	};
}

function treeseedPackageManifestPath(dir: string) {
	for (const fileName of ['treeseed.package.yaml', 'treeseed.package.yml', 'treeseed.package.json', '.treeseed-package.json']) {
		const filePath = resolve(dir, fileName);
		if (existsSync(filePath)) return filePath;
	}
	return null;
}

function readTreeseedPackageManifest(dir: string): TreeseedPackageManifest | null {
	const filePath = treeseedPackageManifestPath(dir);
	return filePath ? readStructuredFile(filePath) as TreeseedPackageManifest | null : null;
}

function stringRecord(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
	return Array.isArray(value) ? value.map((entry) => stringValue(entry)).filter((entry): entry is string => Boolean(entry)) : [];
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
		: id === 'treedx'
			? 'treeseed/treedx'
			: null;
	const repository = stringValue(manifest?.repository) ?? (id === 'treedx' ? 'treeseed-ai/treedx' : null);
	const developmentImages = stringRecord(manifest?.developmentImages);
	const developmentImageHosting = stringRecord(developmentImages.hosting);
	const developmentImageWorkflow = image
		? stringValue(developmentImages.workflow) ?? (id === 'treedx' ? 'dev-image.yml' : null)
		: null;
	const hostedVerifyWorkflow = stringValue(stringRecord(manifest?.releaseGate).workflow)
		?? (existsSync(resolve(dir, '.github/workflows/release-gate.yml')) ? 'release-gate.yml' : null);
	const developmentImageDefaultBranch = stringValue(developmentImages.defaultBranch) ?? 'staging';
	const developmentImageTagPrefix = stringValue(developmentImages.tagPrefix) ?? 'dev';
	const developmentImageMovingTag = developmentImages.movingTag === false ? false : true;
	const developmentImageArchitectures = stringArray(developmentImages.architectures);
	const verify = manifest?.verify && typeof manifest.verify === 'object' && !Array.isArray(manifest.verify)
		? manifest.verify as Record<string, unknown>
		: {};
	const fast = verify.fast ?? (existsSync(resolve(dir, 'scripts/test-treedx-fast.sh')) ? 'scripts/test-treedx-fast.sh' : null);
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
			repository,
			versionSource: versionSourceRel,
			...(developmentImageWorkflow
				? {
					developmentImageWorkflow: developmentImageWorkflow.startsWith('.github/workflows/')
						? developmentImageWorkflow
						: `.github/workflows/${developmentImageWorkflow}`,
					developmentImageDefaultBranch,
					developmentImageTagPrefix,
					developmentImageMovingTag,
					developmentImageArchitectures,
					developmentImageTagPattern: `${image}:${developmentImageTagPrefix}-<branch-slug>-<short-sha>`,
					developmentImageMovingTagPattern: developmentImageMovingTag ? `${image}:${developmentImageTagPrefix}-<branch-slug>` : null,
					developmentImageHosting: Object.keys(developmentImageHosting).length > 0 ? developmentImageHosting : null,
				}
				: {}),
			...(hostedVerifyWorkflow
				? {
					hostedVerifyWorkflow: hostedVerifyWorkflow.startsWith('.github/workflows/')
						? hostedVerifyWorkflow
						: `.github/workflows/${hostedVerifyWorkflow}`,
				}
				: {}),
		},
	};
}

function gitOutput(cwd: string, args: string[]) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
	if (result.status !== 0) {
		const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
		throw new Error(stderr || `git ${args.join(' ')} failed in ${cwd}.`);
	}
	return result.stdout.trim();
}

function branchSlug(value: string) {
	const normalized = value.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 40);
	return normalized || 'branch';
}

export function planTreeseedPackageDevelopmentImage(
	root = workspaceRoot(),
	idOrName: string,
	{ branch }: { branch?: string | null } = {},
): TreeseedPackageDevelopmentImagePlan {
	const adapter = findTreeseedPackageAdapter(root, idOrName);
	if (!adapter) {
		throw new Error(`Treeseed package adapter ${idOrName} was not discovered.`);
	}
	const imageName = typeof adapter.publishTarget === 'string' && adapter.publishTarget.trim()
		? adapter.publishTarget.trim()
		: null;
	if (!imageName) {
		throw new Error(`${adapter.id} does not declare a publish image target.`);
	}
	const metadata = adapter.metadata;
	const workflow = stringValue(metadata.developmentImageWorkflow)?.replace(/^\.github\/workflows\//u, '') ?? null;
	if (!workflow) {
		throw new Error(`${adapter.id} does not declare a development image workflow.`);
	}
	const selectedBranch = branch ?? stringValue(metadata.developmentImageDefaultBranch) ?? 'staging';
	const sha = gitOutput(adapter.dir, ['rev-parse', selectedBranch]);
	const slug = branchSlug(selectedBranch);
	const shortSha = sha.slice(0, 12);
	const tagPrefix = stringValue(metadata.developmentImageTagPrefix) ?? 'dev';
	const immutableTag = `${tagPrefix}-${slug}-${shortSha}`;
	const movingTag = metadata.developmentImageMovingTag === false ? null : `${tagPrefix}-${slug}`;
	const architectures = stringArray(metadata.developmentImageArchitectures);
	const hosting = stringRecord(metadata.developmentImageHosting);
	const app = stringValue(hosting.app);
	const environment = stringValue(hosting.environment) ?? selectedBranch;
	const overrideEnvVar = stringValue(hosting.envVar);
	const imageRef = `${imageName}:${immutableTag}`;
	const movingImageRef = movingTag ? `${imageName}:${movingTag}` : null;
	const hostingImageRef = movingImageRef ?? imageRef;
	return {
		package: {
			id: adapter.id,
			name: adapter.name,
			path: adapter.relativeDir,
			kind: adapter.kind,
			version: adapter.version,
			publishTarget: adapter.publishTarget,
			metadata: adapter.metadata,
		},
		repository: stringValue(metadata.repository) ?? `${adapter.id}`,
		workflow,
		branch: selectedBranch,
		refs: {
			imageName,
			branch: selectedBranch,
			branchSlug: slug,
			sha,
			shortSha,
			immutableTag,
			movingTag,
			imageRef,
			movingImageRef,
			archImageRefs: architectures.map((arch) => `${imageName}:${immutableTag}-${arch}`),
		},
		hosting: app && overrideEnvVar
			? {
				app,
				environment,
				overrideEnvVar,
				override: { [overrideEnvVar]: hostingImageRef },
				command: `${overrideEnvVar}=${hostingImageRef} npx trsd hosting apply --environment ${environment} --app ${app} --execute --json`,
			}
			: null,
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
	const packageDirs = existsSync(packagesDir)
		? readdirSync(packagesDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => resolve(packagesDir, entry.name))
		: [];
	for (const dir of packageDirs) {
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
		metadata: adapter.metadata,
	}));
}
