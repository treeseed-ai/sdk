import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { workspacePackages, workspaceRoot } from './workspace-tools.ts';
import { runTreeseedGit } from './git-runner.ts';
import { resolveTreeseedLaunchEnvironment } from './config-runtime.ts';
import { resolveGitHubCredentialForRepository } from './github-credentials.ts';
import {
	createGitHubApiClient,
	getLatestGitHubWorkflowRun,
} from './github-api.ts';

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
		dockerfile?: string | null;
		context?: string | null;
		target?: string | null;
		role?: string | null;
		architectures?: string[];
	}>;
	releaseChecks: Array<{
		kind: 'npm-pack-dry-run' | 'github-workflow' | 'docker-manifest';
		name: string;
		detail: string;
	}>;
	metadata: Record<string, unknown>;
};

export type TreeseedPackageManifestValidation = {
	packageId: string;
	path: string;
	manifestPath: string | null;
	ok: boolean;
	errors: string[];
	warnings: string[];
};

type TreeseedPackageManifest = {
	id?: unknown;
	name?: unknown;
	kind?: unknown;
	type?: unknown;
	versionSource?: unknown;
	image?: unknown;
	repository?: unknown;
	verify?: unknown;
	releaseGate?: unknown;
	developmentImages?: unknown;
	artifacts?: unknown;
	dockerImages?: unknown;
	capacityProvider?: unknown;
	publishTarget?: unknown;
	githubEnvironments?: unknown;
	requiredSecrets?: unknown;
	workflowTemplateVersion?: unknown;
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
			roleImages?: Array<{
				role: string;
				imageName: string;
				target: string | null;
				immutableRef: string;
				movingRef: string | null;
				archImageRefs: string[];
			}>;
		};
	hosting: {
		app: string;
		environment: string;
		overrideEnvVar: string;
		override: Record<string, string>;
		command: string;
	} | null;
};

export type TreeseedPackageImageWorkflowOptions = {
	root?: string;
	packageId: string;
	branch?: string | null;
	workflow?: string | null;
	execute?: boolean;
	syncConfig?: boolean;
	env?: NodeJS.ProcessEnv;
};

export type TreeseedPackageWorkflowTemplateKind = 'npm-publish' | 'docker-image' | 'dev-image' | 'release-gate';

export type TreeseedPackageWorkflowSyncResult = {
	packageId: string;
	path: string;
	workflow: string;
	template: TreeseedPackageWorkflowTemplateKind;
	exists: boolean;
	changed: boolean;
	written: boolean;
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
	const manifest = readTreeseedPackageManifest(pkg.dir);
	const scripts = pkg.packageJson?.scripts && typeof pkg.packageJson.scripts === 'object' && !Array.isArray(pkg.packageJson.scripts)
		? pkg.packageJson.scripts as Record<string, unknown>
		: {};
	const manifestVerify = manifest?.verify && typeof manifest.verify === 'object' && !Array.isArray(manifest.verify)
		? manifest.verify as Record<string, unknown>
		: {};
	const repository = stringValue(manifest?.repository) ?? normalizeGitHubRepositorySlug(pkg.packageJson?.repository);
	const id = stringValue(manifest?.id) ?? String(pkg.name);
	const name = stringValue(manifest?.name) ?? String(pkg.name);
	const dockerArtifacts = manifestDockerArtifacts(manifest?.artifacts);
	const dockerImages = stringRecord(manifest?.dockerImages);
	const dockerImageReleaseWorkflow = stringValue(dockerImages.releaseWorkflow);
	const dockerImageDevelopmentWorkflow = stringValue(dockerImages.developmentWorkflow);
	const dockerImageArchitectures = stringArray(dockerImages.architectures);
	const dockerImageTags = stringRecord(dockerImages.tags);
	const publishTargetRaw = stringValue(manifest?.publishTarget);
	const publishTarget = dockerArtifacts.length > 0 && publishTargetRaw === 'docker'
		? dockerArtifacts[0]!.name
		: publishTargetRaw ?? 'npm';
	const hostedVerifyWorkflow = stringValue(stringRecord(manifest?.releaseGate).workflow)
		?? (existsSync(resolve(pkg.dir, '.github/workflows/deploy.yml')) ? 'deploy.yml' : null);
	const verifyLocal = typeof scripts['verify:local'] === 'string'
		? 'verify:local'
		: typeof scripts.verify === 'string'
			? 'verify'
			: typeof scripts['verify:action'] === 'string'
				? 'verify:action'
				: null;
	return {
		id,
		name,
		kind: 'node-typescript',
		dir: pkg.dir,
		relativeDir: pkg.relativeDir,
		version: typeof pkg.packageJson?.version === 'string' ? pkg.packageJson.version : null,
		publishTarget,
		manifestPath: treeseedPackageManifestPath(pkg.dir) ?? resolve(pkg.dir, 'package.json'),
		versionSource: resolve(pkg.dir, 'package.json'),
		verifyCommands: {
			fast: commandFromScript(pkg.dir, manifestVerify.fast, 'fast')
				?? (typeof scripts.verify === 'string' ? { label: 'verify', command: 'npm', args: ['run', 'verify'], cwd: pkg.dir } : null),
			local: commandFromScript(pkg.dir, manifestVerify.local, 'local')
				?? (verifyLocal ? { label: verifyLocal, command: 'npm', args: ['run', verifyLocal], cwd: pkg.dir } : null),
			release: commandFromScript(pkg.dir, manifestVerify.release, 'release')
				?? (typeof scripts['release:publish'] === 'string' ? { label: 'release:publish', command: 'npm', args: ['run', 'release:publish'], cwd: pkg.dir } : null),
		},
		artifacts: dockerArtifacts.length > 0
			? dockerArtifacts.map((artifact) => ({
				provider: 'docker' as const,
				name: artifact.name,
				dockerfile: artifact.dockerfile,
				context: artifact.context,
				target: artifact.target,
				role: artifact.role,
				architectures: artifact.architectures,
			}))
			: [{ provider: 'npm', name: String(pkg.name) }],
		releaseChecks: [
			{ kind: 'github-workflow', name: 'publish workflow', detail: dockerImageReleaseWorkflow ? `.github/workflows/${dockerImageReleaseWorkflow}` : '.github/workflows/publish.yml' },
			...(dockerArtifacts.length > 0
				? dockerArtifacts.map((artifact) => ({ kind: 'docker-manifest' as const, name: `${artifact.name} Docker image manifest`, detail: `${artifact.name}:<version>` }))
				: [{ kind: 'npm-pack-dry-run' as const, name: 'npm pack', detail: 'npm pack --dry-run' }]),
		],
		metadata: {
			...(repository ? { repository } : {}),
			...(dockerArtifacts.length > 0
				? {
					dockerArtifacts,
					developmentImageWorkflow: dockerImageDevelopmentWorkflow ? `.github/workflows/${dockerImageDevelopmentWorkflow}` : null,
					developmentImageDefaultBranch: 'staging',
					developmentImageTagPrefix: 'dev',
					developmentImageMovingTag: true,
					developmentImageArchitectures: dockerImageArchitectures,
					developmentImageStagingTags: stringArray(dockerImageTags.staging),
				}
				: {}),
			type: stringValue(manifest?.type) ?? null,
			githubEnvironments: stringArray(manifest?.githubEnvironments),
			requiredSecrets: stringArray(manifest?.requiredSecrets),
			workflowTemplateVersion: stringValue(manifest?.workflowTemplateVersion) ?? null,
			capacityProvider: stringRecord(manifest?.capacityProvider),
			...(hostedVerifyWorkflow
				? {
					hostedVerifyWorkflow: hostedVerifyWorkflow.startsWith('.github/workflows/')
						? hostedVerifyWorkflow
						: `.github/workflows/${hostedVerifyWorkflow}`,
				}
				: {}),
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

function manifestDockerArtifacts(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			const record = stringRecord(entry);
			if (stringValue(record.provider) !== 'docker') return null;
			const name = stringValue(record.name);
			if (!name) return null;
			return {
				provider: 'docker' as const,
				name,
				dockerfile: stringValue(record.dockerfile),
				context: stringValue(record.context),
				target: stringValue(record.target),
				role: stringValue(record.role),
				architectures: stringArray(record.architectures),
			};
		})
		.filter((entry): entry is {
			provider: 'docker';
			name: string;
			dockerfile: string | null;
			context: string | null;
			target: string | null;
			role: string | null;
			architectures: string[];
		} => Boolean(entry));
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
		artifacts: image ? [{
			provider: 'docker',
			name: image,
			tags: version ? [version, shaTag] : [shaTag],
			dockerfile: 'Dockerfile',
			context: '.',
			target: null,
			role: id,
			architectures: developmentImageArchitectures,
		}] : [],
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
			type: stringValue(manifest?.type) ?? null,
			githubEnvironments: stringArray(manifest?.githubEnvironments),
			requiredSecrets: stringArray(manifest?.requiredSecrets),
			workflowTemplateVersion: stringValue(manifest?.workflowTemplateVersion) ?? null,
		},
	};
}

function gitOutput(cwd: string, args: string[]) {
	const result = runTreeseedGit(args, { cwd, mode: 'read' });
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
	const dockerArtifacts = Array.isArray(metadata.dockerArtifacts)
		? metadata.dockerArtifacts
			.map((entry) => {
				const record = stringRecord(entry);
				const artifactImageName = stringValue(record.name);
				if (!artifactImageName) return null;
				return {
					role: stringValue(record.role) ?? artifactImageName.split('/').at(-1)?.replace(/^agent-/u, '') ?? artifactImageName,
					imageName: artifactImageName,
					target: stringValue(record.target),
					architectures: stringArray(record.architectures),
				};
			})
			.filter((entry): entry is {
				role: string;
				imageName: string;
				target: string | null;
				architectures: string[];
			} => Boolean(entry))
		: [];
	const hosting = stringRecord(metadata.developmentImageHosting);
	const app = stringValue(hosting.app);
	const environment = stringValue(hosting.environment) ?? selectedBranch;
	const overrideEnvVar = stringValue(hosting.envVar);
	const imageRef = `${imageName}:${immutableTag}`;
	const movingImageRef = movingTag ? `${imageName}:${movingTag}` : null;
	const hostingImageRef = movingImageRef ?? imageRef;
	const roleImages = dockerArtifacts.length > 0
		? dockerArtifacts.map((artifact) => {
			const artifactArchitectures = artifact.architectures.length > 0 ? artifact.architectures : architectures;
			return {
				role: artifact.role,
				imageName: artifact.imageName,
				target: artifact.target,
				immutableRef: `${artifact.imageName}:${immutableTag}`,
				movingRef: movingTag ? `${artifact.imageName}:${movingTag}` : null,
				archImageRefs: artifactArchitectures.map((arch) => `${artifact.imageName}:${immutableTag}-${arch}`),
			};
		})
		: undefined;
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
				...(roleImages ? { roleImages } : {}),
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
	const normalized = idOrName.trim();
	return discoverTreeseedPackageAdapters(root).find((adapter) => {
		const scopedId = adapter.id.startsWith('@treeseed/') ? adapter.id.slice('@treeseed/'.length) : null;
		const scopedName = adapter.name.startsWith('@treeseed/') ? adapter.name.slice('@treeseed/'.length) : null;
		const directoryName = adapter.relativeDir.split('/').at(-1);
		return adapter.id === normalized
			|| adapter.name === normalized
			|| scopedId === normalized
			|| scopedName === normalized
			|| directoryName === normalized;
	}) ?? null;
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

export async function runTreeseedPackageImageWorkflow(options: TreeseedPackageImageWorkflowOptions) {
	const root = options.root ?? workspaceRoot();
	const branch = options.branch ?? 'staging';
	const imagePlan = planTreeseedPackageDevelopmentImage(root, options.packageId, { branch });
	const selectedWorkflow = options.workflow ?? imagePlan.workflow;
	const execute = options.execute === true;
	const syncConfig = options.syncConfig === true;
	const configEnv = resolveTreeseedLaunchEnvironment({
		tenantRoot: root,
		scope: 'staging',
		baseEnv: options.env ?? process.env,
	});
	const dockerHub = {
		usernameConfigured: Boolean(String(configEnv.DOCKERHUB_USERNAME ?? '').trim()),
		tokenConfigured: Boolean(String(configEnv.DOCKERHUB_TOKEN ?? '').trim()),
		requiredSecrets: ['DOCKERHUB_TOKEN'],
		requiredVariables: ['DOCKERHUB_USERNAME'],
	};
	const credential = resolveGitHubCredentialForRepository(imagePlan.repository, { values: configEnv, env: options.env ?? process.env });
	const githubClientEnv = credential.token
		? { ...configEnv, GH_TOKEN: credential.token, GITHUB_TOKEN: credential.token }
		: configEnv;
	const report: Record<string, unknown> = {
		ok: true,
		action: execute ? 'dispatch' : 'plan',
		package: imagePlan.package,
		repository: imagePlan.repository,
		workflow: selectedWorkflow,
		branch: imagePlan.branch,
		refs: imagePlan.refs,
		credential: {
			repository: credential.repository,
			envName: credential.envName,
			configured: credential.configured,
			source: credential.source,
			fallbackUsed: credential.fallbackUsed,
		},
		dockerHub,
		hosting: imagePlan.hosting,
		reconcile: {
			lifecycle: syncConfig || execute
				? ['refresh', 'diff', 'plan', 'validate', 'apply', 'refresh', 'verify', 'persist']
				: ['refresh', 'diff', 'plan'],
			resources: [
				`package-workflow:${imagePlan.package.id}`,
				...(imagePlan.refs.roleImages
					? imagePlan.refs.roleImages.map((entry) => `package-image:${entry.imageName}`)
					: [`package-image:${imagePlan.refs.imageName}`]),
			],
		},
	};
	if (syncConfig) {
		const environment = imagePlan.hosting?.environment ?? 'staging';
		report.syncedConfig = {
			environment,
			blocked: true,
			reason: 'Package image config sync is reconciler-owned. Use trsd package image --sync-config so github-secret-binding and github-variable-binding resources apply through adapters.',
			secrets: configEnv.DOCKERHUB_TOKEN ? [{ name: 'DOCKERHUB_TOKEN', existed: null }] : [],
			variables: configEnv.DOCKERHUB_USERNAME ? [{ name: 'DOCKERHUB_USERNAME', existed: null }] : [],
		};
	}
	if (execute) {
		const client = createGitHubApiClient({ env: githubClientEnv });
		report.dispatch = {
			blocked: true,
			reason: 'Package image workflow dispatch is reconciler-owned. Use trsd package image --execute so github-workflow-dispatch/package-image resources apply through adapters.',
		};
		report.latestWorkflowRun = await getLatestGitHubWorkflowRun(imagePlan.repository, {
			client,
			workflow: selectedWorkflow,
			branch: imagePlan.branch,
		});
	}
	return { imagePlan, selectedWorkflow, dockerHub, credential, report };
}

export function validateTreeseedPackageManifests(root = workspaceRoot()): TreeseedPackageManifestValidation[] {
	return discoverTreeseedPackageAdapters(root).map((adapter) => {
		const errors: string[] = [];
		const warnings: string[] = [];
		if (!adapter.manifestPath || adapter.manifestPath.endsWith('package.json')) {
			errors.push('missing treeseed.package.yaml');
		}
		if (!adapter.id.trim()) errors.push('missing package id');
		if (!adapter.name.trim()) errors.push('missing package name');
		if (!['node-typescript', 'beam-elixir-rust'].includes(adapter.kind)) {
			errors.push(`unsupported package kind ${adapter.kind}`);
		}
		if (adapter.verifyCommands.local == null) {
			errors.push('missing local verification command');
		}
		if (adapter.releaseChecks.length === 0) {
			warnings.push('package declares no release checks');
		}
		const hasDockerArtifact = adapter.artifacts.some((artifact) => artifact.provider === 'docker');
		if (hasDockerArtifact) {
			const workflow = stringValue(adapter.metadata.developmentImageWorkflow);
			if (!workflow) errors.push('docker package missing development image workflow');
			const architectures = stringArray(adapter.metadata.developmentImageArchitectures);
			if (!architectures.includes('amd64') || !architectures.includes('arm64')) {
				errors.push('docker package must declare amd64 and arm64 architectures');
			}
		}
		for (const artifact of adapter.artifacts) {
			if (artifact.provider === 'docker' && !artifact.name.startsWith('treeseed/')) {
				errors.push(`docker artifact ${artifact.name} must publish under treeseed/*`);
			}
		}
		return {
			packageId: adapter.id,
			path: adapter.relativeDir,
			manifestPath: adapter.manifestPath,
			ok: errors.length === 0,
			errors,
			warnings,
		};
	});
}

function workflowNameForTemplate(adapter: TreeseedPackageAdapter, template: TreeseedPackageWorkflowTemplateKind) {
	const publishWorkflow = 'publish.yml';
	const configuredDevImage = stringValue(adapter.metadata.developmentImageWorkflow)?.replace(/^\.github\/workflows\//u, '') ?? 'dev-image.yml';
	const configuredReleaseGate = stringValue(adapter.metadata.hostedVerifyWorkflow)?.replace(/^\.github\/workflows\//u, '') ?? 'verify.yml';
	if (template === 'dev-image') {
		return configuredDevImage === configuredReleaseGate ? 'dev-image.yml' : configuredDevImage;
	}
	if (template === 'docker-image') return publishWorkflow;
	if (template === 'release-gate') {
		return configuredReleaseGate === publishWorkflow || configuredReleaseGate === configuredDevImage
			? 'release-gate.yml'
			: configuredReleaseGate;
	}
	return publishWorkflow;
}

export function renderTreeseedPackageWorkflow(adapter: TreeseedPackageAdapter, template: TreeseedPackageWorkflowTemplateKind) {
	const verify = adapter.verifyCommands.local
		? formatWorkflowRunCommand(adapter.verifyCommands.local.command, adapter.verifyCommands.local.args)
		: 'npm run verify:local';
	const setup = resolveWorkflowSetupCommand(adapter);
	const dockerArtifacts = adapter.artifacts.filter((artifact) => artifact.provider === 'docker');
	if (template === 'npm-publish') {
		return `name: Publish ${adapter.name}

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

jobs:
  publish:
    if: startsWith(github.ref, 'refs/tags/') && !contains(github.ref_name, '-')
    runs-on: ubuntu-latest
    permissions:
      contents: write
    environment: production
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
      - run: ${setup}
      - run: ${verify}
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
      - name: Create GitHub release
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gh release create "\${GITHUB_REF_NAME}" --generate-notes --verify-tag
`;
	}
	if (template === 'docker-image' || template === 'dev-image') {
		const tags = template === 'dev-image'
			? 'type=raw,value=dev-${{ github.ref_name }}-${{ github.sha }}'
			: 'type=semver,pattern={{version}}';
		return `name: ${template === 'dev-image' ? 'Development Image' : 'Publish Image'} ${adapter.name}

on:
  workflow_dispatch:
  push:
    branches:
      - staging
    tags:
      - "v*"

jobs:
  image:
    if: startsWith(github.ref, 'refs/tags/') && !contains(github.ref_name, '-')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
    strategy:
      matrix:
        include:
${dockerArtifacts.map((artifact) => `          - image: ${artifact.name}`).join('\n') || '          - image: treeseed/unknown'}
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - run: ${setup}
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          username: \${{ vars.DOCKERHUB_USERNAME }}
          password: \${{ secrets.DOCKERHUB_TOKEN }}
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: \${{ matrix.image }}
          tags: ${tags}
      - uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
      - name: Create GitHub release
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gh release create "\${GITHUB_REF_NAME}" --generate-notes --verify-tag
`;
	}
	return `name: Verify ${adapter.name}

on:
  push:
  pull_request:
  workflow_dispatch:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: ${setup}
      - run: ${verify}
`;
}

function resolveWorkflowSetupCommand(adapter: TreeseedPackageAdapter) {
	const scripts = adapter.metadata.scripts;
	if (isRecord(scripts) && typeof scripts['release:setup'] === 'string') {
		return 'npm run release:setup || (echo "dependency install failed; retrying" && npm run release:setup)';
	}
	return 'npm ci || (echo "dependency install failed; retrying" && npm ci)';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function formatWorkflowRunCommand(command: string, args: string[]) {
	return [command, ...args].map(shellQuoteWorkflowArg).join(' ');
}

function shellQuoteWorkflowArg(value: string) {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
	return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function workflowTemplatesForAdapter(adapter: TreeseedPackageAdapter): TreeseedPackageWorkflowTemplateKind[] {
	const hasDocker = adapter.artifacts.some((artifact) => artifact.provider === 'docker');
	const hasNpm = adapter.artifacts.some((artifact) => artifact.provider === 'npm');
	return [
		...(hasNpm ? ['npm-publish' as const] : []),
		...(hasDocker ? ['docker-image' as const, 'dev-image' as const] : []),
		'release-gate' as const,
	];
}

export function syncTreeseedPackageWorkflows({
	root = workspaceRoot(),
	packageId,
	execute = false,
}: {
	root?: string;
	packageId?: string | null;
	execute?: boolean;
} = {}): TreeseedPackageWorkflowSyncResult[] {
	const adapters = packageId && packageId !== 'all'
		? [findTreeseedPackageAdapter(root, packageId)].filter((entry): entry is TreeseedPackageAdapter => Boolean(entry))
		: discoverTreeseedPackageAdapters(root);
	const results: TreeseedPackageWorkflowSyncResult[] = [];
	for (const adapter of adapters) {
		for (const template of workflowTemplatesForAdapter(adapter)) {
			const workflow = workflowNameForTemplate(adapter, template);
			const path = resolve(adapter.dir, '.github', 'workflows', workflow);
			const rendered = renderTreeseedPackageWorkflow(adapter, template);
			const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
			const changed = current !== rendered;
			if (execute && changed) {
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, rendered, 'utf8');
			}
			results.push({
				packageId: adapter.id,
				path,
				workflow,
				template,
				exists: current != null,
				changed,
				written: execute && changed,
			});
		}
	}
	return results;
}
