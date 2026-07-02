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
import { resolveTreeseedDockerhubToken, resolveTreeseedDockerhubUsername } from '../../service-credentials.ts';
import { inspectTreeseedContentStructure } from '../../platform/content-runtime-source.ts';
import type {
	SeedContentPublishTargetKind,
	SeedContentRuntimeSource,
	SeedLocalContentMaterialization,
	SeedProjectArchitecture,
	SeedProjectResource,
	SeedProjectTopology,
} from '../../seeds/types.ts';
import {
	SEED_CONTENT_PUBLISH_TARGETS,
	SEED_CONTENT_RUNTIME_SOURCES,
	SEED_LOCAL_CONTENT_MATERIALIZATIONS,
	SEED_PROJECT_TOPOLOGIES,
} from '../../seeds/types.ts';

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
	hostedVerifyWorkflow?: unknown;
	artifacts?: unknown;
	dockerImages?: unknown;
	capacityProvider?: unknown;
	publishTarget?: unknown;
	deploymentSource?: unknown;
	githubEnvironments?: unknown;
	requiredSecrets?: unknown;
	requiredVariables?: unknown;
	workflowTemplateVersion?: unknown;
	projectArchitecture?: unknown;
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
		immutableTag: string | null;
		movingTag: string | null;
			imageRef: string | null;
			movingImageRef: string | null;
			archImageRefs: string[];
			roleImages?: Array<{
				role: string;
				imageName: string;
				target: string | null;
				immutableRef: string | null;
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
	deploymentSource: {
		environment: string;
		mode: 'git' | 'image';
		repository: string;
		commitSha: string;
		imagePublicationRequired: boolean;
	};
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

export type TreeseedPackageWorkflowTemplateKind = 'npm-publish' | 'docker-image' | 'release-gate';

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

function normalizePackageSlug(id: string) {
	const raw = id.startsWith('@treeseed/') ? id.slice('@treeseed/'.length) : id;
	return raw.toLowerCase()
		.replace(/^treeseed-/u, '')
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '') || 'package';
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function normalizeTreeseedPackageProjectArchitecture(value: unknown, packageId: string): SeedProjectArchitecture | null {
	const record = stringRecord(value);
	if (Object.keys(record).length === 0) return null;
	const publishTarget = stringRecord(record.contentPublishTarget);
	const packageSlug = normalizePackageSlug(packageId);
	const targetKind = enumValue<SeedContentPublishTargetKind>(publishTarget.kind, SEED_CONTENT_PUBLISH_TARGETS, 'cloudflare_r2');
	return {
		topology: enumValue<SeedProjectTopology>(record.topology, SEED_PROJECT_TOPOLOGIES, 'single_repository_site'),
		rootPath: stringValue(record.rootPath) ?? '.',
		sitePath: stringValue(record.sitePath) ?? 'docs',
		contentPath: stringValue(record.contentPath) ?? 'docs',
		contentRuntimeSource: enumValue<SeedContentRuntimeSource>(record.contentRuntimeSource, SEED_CONTENT_RUNTIME_SOURCES, 'r2_published_manifest'),
		localContentMaterialization: enumValue<SeedLocalContentMaterialization>(record.localContentMaterialization, SEED_LOCAL_CONTENT_MATERIALIZATIONS, 'none'),
		contentPublishTarget: {
			kind: targetKind,
			...(stringValue(publishTarget.bucket) ? { bucket: stringValue(publishTarget.bucket)! } : {}),
			prefix: stringValue(publishTarget.prefix) ?? `packages/${packageSlug}`,
			...(stringValue(publishTarget.manifestPath) ? { manifestPath: stringValue(publishTarget.manifestPath)! } : {}),
		},
	};
}

function docsSiteReadiness(dir: string, architecture: SeedProjectArchitecture | null) {
	if (!architecture) return null;
	const diagnostic = inspectTreeseedContentStructure({ projectRoot: dir, architecture });
	const readiness = diagnostic.status === 'ready'
		? 'ready'
		: diagnostic.status === 'unsupported_structure'
			? 'unsupported_structure'
			: 'site_not_prepared';
	return {
		status: readiness,
		diagnostic,
	};
}

function deploymentSourceModeForBranch(metadata: Record<string, unknown>, branch: string) {
	const source = stringRecord(metadata.deploymentSource);
	const normalizedBranch = branch === 'prod' || branch === 'production' || branch === 'main' ? 'prod' : branch === 'staging' ? 'staging' : 'local';
	const configured = stringValue(source[normalizedBranch]);
	return configured === 'git' || configured === 'image'
		? configured
		: normalizedBranch === 'prod'
			? 'image'
			: stringValue(source.staging) === 'git'
				? 'git'
				: null;
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
	const dockerImageArchitectures = stringArray(dockerImages.architectures);
	const publishTargetRaw = stringValue(manifest?.publishTarget);
	const publishTarget = dockerArtifacts.length > 0 && publishTargetRaw === 'docker'
		? dockerArtifacts[0]!.name
		: publishTargetRaw ?? 'npm';
	const hostedVerifyWorkflow = stringValue(manifest?.hostedVerifyWorkflow)
		?? stringValue(stringRecord(manifest?.releaseGate).workflow)
		?? (existsSync(resolve(pkg.dir, '.github/workflows/deploy.yml')) ? 'deploy.yml' : null);
	const projectArchitecture = normalizeTreeseedPackageProjectArchitecture(manifest?.projectArchitecture, id);
	const docsReadiness = docsSiteReadiness(pkg.dir, projectArchitecture);
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
			deploymentSource: stringRecord(manifest?.deploymentSource),
			...(dockerArtifacts.length > 0
				? {
					dockerArtifacts,
					dockerImageReleaseWorkflow: dockerImageReleaseWorkflow ? `.github/workflows/${dockerImageReleaseWorkflow}` : '.github/workflows/publish.yml',
					dockerImageArchitectures,
					imageHosting: stringRecord(dockerImages.hosting),
				}
				: {}),
			type: stringValue(manifest?.type) ?? null,
			githubEnvironments: stringArray(manifest?.githubEnvironments),
			requiredSecrets: stringArray(manifest?.requiredSecrets),
			requiredVariables: stringArray(manifest?.requiredVariables),
			workflowTemplateVersion: stringValue(manifest?.workflowTemplateVersion) ?? null,
			localDev: stringRecord(manifest?.localDev),
			capacityProvider: stringRecord(manifest?.capacityProvider),
			...(projectArchitecture
				? {
					projectArchitecture,
					docsSiteReadiness: docsReadiness?.status ?? 'site_not_prepared',
					docsSiteDiagnostic: docsReadiness?.diagnostic ?? null,
				}
				: {}),
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
	const dockerArtifacts = manifestDockerArtifacts(manifest?.artifacts);
	const repository = stringValue(manifest?.repository) ?? (id === 'treedx' ? 'treeseed-ai/treedx' : null);
	const hostedVerifyWorkflow = stringValue(manifest?.hostedVerifyWorkflow)
		?? stringValue(stringRecord(manifest?.releaseGate).workflow)
		?? (existsSync(resolve(dir, '.github/workflows/release-gate.yml')) ? 'release-gate.yml' : null);
	const projectArchitecture = normalizeTreeseedPackageProjectArchitecture(manifest?.projectArchitecture, id);
	const docsReadiness = docsSiteReadiness(dir, projectArchitecture);
	const verify = manifest?.verify && typeof manifest.verify === 'object' && !Array.isArray(manifest.verify)
		? manifest.verify as Record<string, unknown>
		: {};
	const fast = verify.fast ?? (existsSync(resolve(dir, 'scripts/test-treedx-fast.sh')) ? 'scripts/test-treedx-fast.sh' : null);
	const local = verify.local ?? (existsSync(resolve(dir, 'scripts/test-all.sh')) ? 'scripts/test-all.sh' : null);
	const releaseGate = stringValue(manifest?.releaseGate)
		?? verify.release
		?? (existsSync(resolve(dir, 'scripts/release-gate.sh')) ? 'scripts/release-gate.sh' : null);
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
		artifacts: dockerArtifacts.length > 0
			? dockerArtifacts.map((artifact) => ({
				provider: 'docker' as const,
				name: artifact.name,
				tags: version ? [version, shaTag] : [shaTag],
				dockerfile: artifact.dockerfile ?? 'Dockerfile',
				context: artifact.context ?? '.',
				target: artifact.target,
				role: artifact.role ?? id,
				architectures: artifact.architectures.length > 0
					? artifact.architectures
					: stringArray(stringRecord(manifest?.dockerImages).architectures),
			}))
			: image ? [{
				provider: 'docker',
				name: image,
				tags: version ? [version, shaTag] : [shaTag],
				dockerfile: 'Dockerfile',
				context: '.',
				target: null,
				role: id,
				architectures: stringArray(stringRecord(manifest?.dockerImages).architectures),
			}] : [],
		releaseChecks: dockerArtifacts.length > 0
			? dockerArtifacts.map((artifact) => ({ kind: 'docker-manifest' as const, name: `${artifact.name} Docker image manifest`, detail: `${artifact.name}:${version ?? '<version>'}` }))
			: image
				? [{ kind: 'docker-manifest', name: 'Docker image manifest', detail: `${image}:${version ?? '<version>'}` }]
			: [],
		metadata: {
			hasCargo: existsSync(resolve(dir, 'Cargo.toml')),
			hasDockerfile: existsSync(resolve(dir, 'Dockerfile')),
			repository,
			deploymentSource: stringRecord(manifest?.deploymentSource),
			imageHosting: stringRecord(stringRecord(manifest?.dockerImages).hosting),
			versionSource: versionSourceRel,
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
			requiredVariables: stringArray(manifest?.requiredVariables),
			workflowTemplateVersion: stringValue(manifest?.workflowTemplateVersion) ?? null,
			...(projectArchitecture
				? {
					projectArchitecture,
					docsSiteReadiness: docsReadiness?.status ?? 'site_not_prepared',
					docsSiteDiagnostic: docsReadiness?.diagnostic ?? null,
				}
				: {}),
		},
	};
}

function gitOutput(cwd: string, args: string[]) {
	const result = runTreeseedGit(args, { cwd, mode: 'read' });
	return result.stdout.trim();
}

function gitRevisionSha(cwd: string, revision: string) {
	try {
		return gitOutput(cwd, ['rev-parse', revision]);
	} catch (error) {
		if (/^[A-Za-z0-9._/-]+$/u.test(revision) && !revision.startsWith('origin/')) {
			try {
				return gitOutput(cwd, ['rev-parse', `origin/${revision}`]);
			} catch {
				// Report the original revision failure so the command reflects what the user requested.
			}
		}
		throw error;
	}
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
	const firstDockerArtifact = adapter.artifacts.find((artifact) => artifact.provider === 'docker') ?? null;
	const imageName = typeof adapter.publishTarget === 'string' && adapter.publishTarget.trim()
		? adapter.publishTarget.trim()
		: firstDockerArtifact?.name ?? null;
	if (!imageName) {
		throw new Error(`${adapter.id} does not declare a publish image target.`);
	}
	const metadata = adapter.metadata;
	const selectedBranch = branch ?? 'staging';
	const deploymentSourceMode = deploymentSourceModeForBranch(metadata, selectedBranch);
	const sha = gitRevisionSha(adapter.dir, selectedBranch);
	const shortSha = sha.slice(0, 12);
	const deploymentEnvironment = selectedBranch === 'main' ? 'prod' : selectedBranch;
	const imagePublicationRequired = (deploymentSourceMode ?? 'image') === 'image';
	if (deploymentEnvironment !== 'prod' && imagePublicationRequired) {
		throw new Error(`${adapter.id} non-production package image planning is tagless and must use deploymentSource git.`);
	}
	const workflow = imagePublicationRequired
		? stringValue(metadata.dockerImageReleaseWorkflow)?.replace(/^\.github\/workflows\//u, '') ?? 'publish.yml'
		: 'source-build';
	const productionImageTag = deploymentEnvironment === 'prod' ? adapter.version : null;
	if (deploymentEnvironment === 'prod' && (!productionImageTag || !/^\d+\.\d+\.\d+$/u.test(productionImageTag))) {
		throw new Error(`${adapter.id} production image publication requires a stable semantic package version.`);
	}
	const immutableTag = productionImageTag;
	const movingTag = null;
	const architectures = stringArray(metadata.dockerImageArchitectures);
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
	const imageHosting = stringRecord(metadata.imageHosting);
	const app = stringValue(imageHosting.app);
	const overrideEnvVar = stringValue(imageHosting.envVar);
	const environment = deploymentEnvironment === 'prod'
		? 'prod'
		: stringValue(imageHosting.environment) ?? selectedBranch;
	const imageRef = immutableTag ? `${imageName}:${immutableTag}` : null;
	const movingImageRef = null;
	const hostingImageRef = movingImageRef ?? imageRef;
	const roleImages = dockerArtifacts.length > 0
		? dockerArtifacts.map((artifact) => {
			const artifactArchitectures = artifact.architectures.length > 0 ? artifact.architectures : architectures;
			return {
				role: artifact.role,
				imageName: artifact.imageName,
				target: artifact.target,
				immutableRef: immutableTag ? `${artifact.imageName}:${immutableTag}` : null,
				movingRef: null,
				archImageRefs: immutableTag ? artifactArchitectures.map((arch) => `${artifact.imageName}:${immutableTag}-${arch}`) : [],
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
			branchSlug: branchSlug(selectedBranch),
			sha,
			shortSha,
			immutableTag,
			movingTag,
				imageRef,
				movingImageRef,
				archImageRefs: immutableTag ? architectures.map((arch) => `${imageName}:${immutableTag}-${arch}`) : [],
				...(roleImages ? { roleImages } : {}),
		},
		deploymentSource: {
			environment: deploymentEnvironment,
			mode: deploymentSourceMode ?? 'image',
			repository: stringValue(metadata.repository) ?? `${adapter.id}`,
			commitSha: sha,
			imagePublicationRequired,
		},
		hosting: imagePublicationRequired && app && overrideEnvVar && hostingImageRef
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
	const dockerHubUsername = resolveTreeseedDockerhubUsername(configEnv);
	const dockerHubToken = resolveTreeseedDockerhubToken(configEnv);
	const dockerHub = {
		usernameConfigured: Boolean(dockerHubUsername),
		tokenConfigured: Boolean(dockerHubToken),
		requiredSecrets: imagePlan.deploymentSource?.imagePublicationRequired === false ? [] : ['TREESEED_DOCKERHUB_TOKEN'],
		requiredVariables: imagePlan.deploymentSource?.imagePublicationRequired === false ? [] : ['TREESEED_DOCKERHUB_USERNAME'],
	};
	const credential = resolveGitHubCredentialForRepository(imagePlan.repository, { values: configEnv, env: options.env ?? process.env });
	const githubClientEnv = credential.token
		? { ...configEnv, TREESEED_GITHUB_TOKEN: credential.token, GH_TOKEN: credential.token, GITHUB_TOKEN: credential.token }
		: configEnv;
	const report: Record<string, unknown> = {
		ok: true,
		action: execute ? 'dispatch' : 'plan',
		package: imagePlan.package,
		repository: imagePlan.repository,
		workflow: selectedWorkflow,
		branch: imagePlan.branch,
		refs: imagePlan.refs,
		deploymentSource: imagePlan.deploymentSource,
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
				...(imagePlan.deploymentSource?.imagePublicationRequired === false
					? [`source-build:${imagePlan.repository}#${imagePlan.deploymentSource.commitSha}`]
					: imagePlan.refs.roleImages
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
			reason: imagePlan.deploymentSource?.imagePublicationRequired === false
				? 'Staging source-build policy does not sync Docker image credentials or image override variables.'
				: 'Package image config sync is reconciler-owned. Use trsd package image --sync-config so github-secret-binding and github-variable-binding resources apply through adapters.',
			secrets: dockerHubToken ? [{ name: 'TREESEED_DOCKERHUB_TOKEN', existed: null }] : [],
			variables: dockerHubUsername ? [{ name: 'TREESEED_DOCKERHUB_USERNAME', existed: null }] : [],
		};
	}
	if (execute) {
		const client = createGitHubApiClient({ env: githubClientEnv });
		report.dispatch = {
			blocked: true,
			reason: imagePlan.deploymentSource?.imagePublicationRequired === false
				? 'Staging deployment source is GitHub source build; routine development Docker image publication is disabled.'
				: 'Package image workflow dispatch is reconciler-owned. Use trsd package image --execute so github-workflow-dispatch/package-image resources apply through adapters.',
		};
		if (imagePlan.deploymentSource?.imagePublicationRequired !== false) {
			report.latestWorkflowRun = await getLatestGitHubWorkflowRun(imagePlan.repository, {
				client,
				workflow: selectedWorkflow,
				branch: imagePlan.branch,
			});
		}
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
		if (!adapter.metadata.projectArchitecture) {
			warnings.push('package does not declare projectArchitecture metadata');
		}
		if (adapter.releaseChecks.length === 0) {
			warnings.push('package declares no release checks');
		}
		const hasDockerArtifact = adapter.artifacts.some((artifact) => artifact.provider === 'docker');
		if (hasDockerArtifact) {
			const deploymentSource = stringRecord(adapter.metadata.deploymentSource);
			if (stringValue(deploymentSource.staging) !== 'git') {
				errors.push('docker package must declare deploymentSource.staging: git');
			}
			if (stringValue(deploymentSource.prod) !== 'image') {
				errors.push('docker package must declare deploymentSource.prod: image');
			}
			const architectures = stringArray(adapter.metadata.dockerImageArchitectures);
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

export function deriveTreeseedPackageProjectResources(
	root = workspaceRoot(),
	options: { team?: string } = {},
): SeedProjectResource[] {
	const team = options.team ?? 'team:treeseed';
	return discoverTreeseedPackageAdapters(root)
		.map((adapter): SeedProjectResource | null => {
			const architecture = adapter.metadata.projectArchitecture as SeedProjectArchitecture | undefined;
			const repository = stringValue(adapter.metadata.repository);
			if (!architecture || !repository) return null;
			const [owner, name] = repository.split('/');
			if (!owner || !name) return null;
			const slug = normalizePackageSlug(adapter.id);
			return {
				key: `project:treeseed/${slug}`,
				team,
				slug,
				name: adapter.name,
				description: `${adapter.name} first-party package project.`,
				kind: 'package',
				repository: {
					role: 'primary',
					provider: 'github',
					owner,
					name,
					gitUrl: `https://github.com/${owner}/${name}.git`,
					defaultBranch: 'main',
					checkoutPath: adapter.relativeDir,
				},
				architecture,
				metadata: {
					packageId: adapter.id,
					packagePath: adapter.relativeDir,
					visibility: 'public',
					docsSiteReadiness: stringValue(adapter.metadata.docsSiteReadiness) ?? 'site_not_prepared',
					releaseOwnership: 'treeseed.package.yaml',
				},
			};
		})
		.filter((entry): entry is SeedProjectResource => Boolean(entry));
}

function workflowNameForTemplate(adapter: TreeseedPackageAdapter, template: TreeseedPackageWorkflowTemplateKind) {
	const publishWorkflow = 'publish.yml';
	const configuredReleaseGate = stringValue(adapter.metadata.hostedVerifyWorkflow)?.replace(/^\.github\/workflows\//u, '') ?? 'verify.yml';
	if (template === 'docker-image') return publishWorkflow;
	if (template === 'release-gate') {
		return configuredReleaseGate === publishWorkflow
			? 'release-gate.yml'
			: configuredReleaseGate;
	}
	return publishWorkflow;
}

export function renderTreeseedPackageWorkflow(adapter: TreeseedPackageAdapter, template: TreeseedPackageWorkflowTemplateKind) {
	const verifyCommand = template === 'release-gate'
		? adapter.verifyCommands.release ?? adapter.verifyCommands.local
		: adapter.verifyCommands.local;
	const verify = verifyCommand
		? formatWorkflowRunCommand(verifyCommand.command, verifyCommand.args)
		: 'npm run verify:local';
	const setup = resolveWorkflowSetupCommand(adapter);
	const dockerArtifacts = adapter.artifacts.filter((artifact) => artifact.provider === 'docker');
	if (template === 'npm-publish') {
		return `name: Publish ${adapter.name}

on:
  push:
    tags:
      - "*.*.*"
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
	if (template === 'docker-image') {
		const environment = 'production';
		const imageSetup = adapter.kind === 'node-typescript' ? resolveDockerImageWorkflowSetupCommand() : null;
		const anyTarget = dockerArtifacts.some((artifact) => typeof artifact.target === 'string' && artifact.target.trim().length > 0);
		const dockerContextPrepareCommand = isRecord(adapter.metadata.scripts) && typeof adapter.metadata.scripts['capacity-provider:build'] === 'string'
			? 'npm run capacity-provider:build -- --prepare-only'
			: null;
		const trigger = `    tags:
      - "*.*.*"`;
		const jobCondition = "startsWith(github.ref, 'refs/tags/') && !contains(github.ref_name, '-')";
		const computeTagsStep = `      - name: Compute image tags
        id: tags
        run: |
          version="\${GITHUB_REF_NAME#v}"
          echo "base=\${version}" >> "$GITHUB_OUTPUT"
          echo "moving=" >> "$GITHUB_OUTPUT"
`;
		const releaseStep = `  release:
    needs: manifest
    if: ${jobCondition}
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Create GitHub release
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gh release create "\${GITHUB_REF_NAME}" --generate-notes --verify-tag
`;
		return `name: Publish Image ${adapter.name}

on:
  workflow_dispatch:
  push:
${trigger}

jobs:
  build:
    if: ${jobCondition}
    runs-on: \${{ matrix.runner }}
    permissions:
      contents: write
      packages: write
    environment: ${environment}
    strategy:
      matrix:
        include:
${dockerArtifacts.flatMap((artifact) => [
	`          - image: ${artifact.name}${anyTarget ? `\n            target: ${artifact.target ?? ''}` : ''}
            arch: amd64
            platform: linux/amd64
            runner: ubuntu-24.04`,
	`          - image: ${artifact.name}${anyTarget ? `\n            target: ${artifact.target ?? ''}` : ''}
            arch: arm64
            platform: linux/arm64
            runner: ubuntu-24.04-arm`,
]).join('\n') || `          - image: treeseed/unknown
            arch: amd64
            platform: linux/amd64
            runner: ubuntu-24.04`}
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
${imageSetup ? `      - run: ${imageSetup}\n` : ''}${dockerContextPrepareCommand ? `      - run: ${dockerContextPrepareCommand}\n` : ''}${computeTagsStep}      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          username: \${{ vars.TREESEED_DOCKERHUB_USERNAME }}
          password: \${{ secrets.TREESEED_DOCKERHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
${anyTarget ? '          target: ${{ matrix.target }}\n' : ''}          platforms: \${{ matrix.platform }}
          push: true
          tags: \${{ matrix.image }}:\${{ steps.tags.outputs.base }}-\${{ matrix.arch }}

  manifest:
    needs: build
    if: ${jobCondition}
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: write
    environment: ${environment}
    strategy:
      matrix:
        include:
${dockerArtifacts.map((artifact) => `          - image: ${artifact.name}`).join('\n') || '          - image: treeseed/unknown'}
    steps:
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          username: \${{ vars.TREESEED_DOCKERHUB_USERNAME }}
          password: \${{ secrets.TREESEED_DOCKERHUB_TOKEN }}
${computeTagsStep}      - name: Publish multi-architecture manifest
        run: |
          docker buildx imagetools create \\
            -t "\${{ matrix.image }}:\${{ steps.tags.outputs.base }}" \\
            "\${{ matrix.image }}:\${{ steps.tags.outputs.base }}-amd64" \\
            "\${{ matrix.image }}:\${{ steps.tags.outputs.base }}-arm64"
${releaseStep}`;
	}
	const needsNodeSetup = adapter.kind === 'node-typescript';
	const needsBeamSetup = adapter.kind === 'beam-elixir-rust';
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
${needsNodeSetup ? `      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: ${setup}
` : ''}${needsBeamSetup ? `      - uses: erlef/setup-beam@v1
        with:
          otp-version: "27"
          elixir-version: "1.17.3"
      - run: mix local.hex --force && mix local.rebar --force
` : ''}      - run: ${verify}
`;
}

function resolveWorkflowSetupCommand(adapter: TreeseedPackageAdapter) {
	const scripts = adapter.metadata.scripts;
	if (isRecord(scripts) && typeof scripts['release:setup'] === 'string') {
		return 'npm run release:setup || (echo "dependency install failed; retrying" && npm run release:setup)';
	}
	return 'npm ci || (echo "dependency install failed; retrying" && npm ci)';
}

function resolveDockerImageWorkflowSetupCommand() {
	return 'npm ci --ignore-scripts || (echo "dependency install failed; retrying" && npm ci --ignore-scripts)';
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
		...(hasDocker ? ['docker-image' as const] : []),
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
