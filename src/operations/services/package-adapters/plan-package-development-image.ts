import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { workspacePackages, workspaceRoot } from '../treedx/workspaces/workspace-tools.ts';
import { runRepositoryGit } from '../operations/git-runner.ts';
import { resolveLaunchEnvironment } from '../configuration/config-runtime.ts';
import { resolveGitHubCredentialForRepository } from '../configuration/github-credentials.ts';
import {
	createGitHubApiClient,
	getLatestGitHubWorkflowRun,
} from '../repositories/github-api.ts';
import { resolveDockerhubToken, resolveDockerhubUsername } from '../../../configuration/service-credentials.ts';
import { inspectContentStructure } from '../../../platform/content/content-runtime-source.ts';
import type {
	SeedContentPublishTargetKind,
	SeedContentRuntimeSource,
	SeedLocalContentMaterialization,
	SeedProjectArchitecture,
	SeedProjectResource,
	SeedProjectTopology,
} from '../../../seeds/types.ts';
import {
	SEED_CONTENT_PUBLISH_TARGETS,
	SEED_CONTENT_RUNTIME_SOURCES,
	SEED_LOCAL_CONTENT_MATERIALIZATIONS,
	SEED_PROJECT_TOPOLOGIES,
} from '../../../seeds/types.ts';
import { PackageAdapter, PackageDevelopmentImagePlan, PackageImageWorkflowOptions } from './package-kind.ts';
import { deploymentSourceModeForBranch, nodeTypeScriptAdapter, stringArray, stringRecord, stringValue } from './deployment-source-mode-for-branch.ts';
import { beamPackageAdapter, branchSlug, gitRevisionSha } from './beam-package-adapter.ts';

export function planPackageDevelopmentImage(
	root = workspaceRoot(),
	idOrName: string,
	{ branch }: { branch?: string | null } = {},
): PackageDevelopmentImagePlan {
	const adapter = findPackageAdapter(root, idOrName);
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
				command: `${overrideEnvVar}=${hostingImageRef} npx trsd hosting apply --environment ${environment} --app ${app} --json`,
			}
			: null,
	};
}

export function discoverPackageAdapters(root = workspaceRoot()): PackageAdapter[] {
	const adapters = new Map<string, PackageAdapter>();
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

export function findPackageAdapter(root: string, idOrName: string) {
	const normalized = idOrName.trim();
	return discoverPackageAdapters(root).find((adapter) => {
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
	return discoverPackageAdapters(root).map((adapter) => ({
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
			capabilities: adapter.capabilities,
		releaseChecks: adapter.releaseChecks,
		metadata: adapter.metadata,
	}));
}

export async function runPackageImageWorkflow(options: PackageImageWorkflowOptions) {
	const root = options.root ?? workspaceRoot();
	const branch = options.branch ?? 'staging';
	const imagePlan = planPackageDevelopmentImage(root, options.packageId, { branch });
	const selectedWorkflow = options.workflow ?? imagePlan.workflow;
	const execute = options.execute === true;
	const syncConfig = options.syncConfig === true;
	const configEnv = resolveLaunchEnvironment({
		tenantRoot: root,
		scope: 'staging',
		baseEnv: options.env ?? process.env,
	});
	const dockerHubUsername = resolveDockerhubUsername(configEnv);
	const dockerHubToken = resolveDockerhubToken(configEnv);
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
