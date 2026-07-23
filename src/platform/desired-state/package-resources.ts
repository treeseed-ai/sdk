import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
	discoverTreeseedPackageAdapters,
	type TreeseedPackageAdapter,
} from '../../operations/services/package-adapters.ts';
import { redactCapacityProviderEnv, validateAndDigestCapacityProviderManifest } from '../../capacity-provider.ts';
import { workspaceRoot } from '../../operations/services/workspace-tools.ts';
import {
	checkedOutTemplateRepositories,
	type TreeseedTemplateRepositoryManifest,
} from '../../operations/services/managed-repositories.ts';
import { deriveTreeseedDesiredUnits } from '../../reconcile/desired-state.ts';
import type { TreeseedDesiredUnit, TreeseedReconcileSelector, TreeseedReconcileTarget } from '../../reconcile/contracts.ts';
import {
	buildProjectLocalContentResources,
	type TreeseedLocalContentMode,
} from '../local-content-materialization.ts';
import { localTreeDxSeedDigest } from '../local-treedx-seed.ts';
import { TreeseedDesiredEnvironment, TreeseedDesiredResource, TreeseedTemplateUnit, dockerPlatforms, localDockerPlatform, materializeDockerImageTags, packageReleaseCapability, packageRequiredSecretsForGitHubEnvironment, packageRequiredVariablesForGitHubEnvironment, stringArray, stringRecord, workflowName } from './treeseed-desired-environment.ts';

export function packageResources(adapter: TreeseedPackageAdapter, environment: TreeseedDesiredEnvironment): TreeseedDesiredResource[] {
	const resources: TreeseedDesiredResource[] = [];
	const packageId = adapter.id;
	const repository = typeof adapter.metadata.repository === 'string' ? adapter.metadata.repository : null;
	const dockerImageConfig = stringRecord(adapter.metadata.dockerImages);
	const dockerWorkflow = workflowName(
		environment === 'prod'
			? dockerImageConfig.releaseWorkflow
			: null,
		environment === 'prod' ? 'publish.yml' : 'source-build',
	);
	resources.push({
		id: `package-manifest:${packageId}`,
		kind: 'package-manifest',
		provider: 'treeseed',
		environment,
		packageId,
		serviceId: null,
		logicalName: `${packageId} manifest`,
		dependencies: [],
		spec: {
			packageId,
			packageRoot: adapter.dir,
			manifestPath: adapter.manifestPath,
			kind: adapter.kind,
			type: adapter.metadata.type ?? null,
			releaseCapability: packageReleaseCapability(adapter),
			requiredSecrets: adapter.metadata.requiredSecrets ?? [],
			requiredVariables: adapter.metadata.requiredVariables ?? [],
			githubEnvironments: adapter.metadata.githubEnvironments ?? [],
		},
		source: { type: 'package-adapter', id: packageId },
	});
	if (adapter.releaseChecks.length > 0) {
		resources.push({
			id: `package-workflow:${packageId}`,
			kind: 'package-workflow',
			provider: 'github',
			environment,
			packageId,
			serviceId: null,
			logicalName: `${packageId} workflows`,
			dependencies: [`package-manifest:${packageId}`],
			spec: {
				packageId,
				packageRoot: adapter.dir,
				repository,
				releaseChecks: adapter.releaseChecks,
				verifyCommands: adapter.verifyCommands,
				githubEnvironments: adapter.metadata.githubEnvironments ?? [],
				workflowTemplateVersion: adapter.metadata.workflowTemplateVersion ?? 1,
			},
			source: { type: 'package-adapter', id: packageId },
		});
		for (const environmentName of Array.isArray(adapter.metadata.githubEnvironments) ? adapter.metadata.githubEnvironments : []) {
			if (typeof environmentName !== 'string' || !environmentName.trim()) continue;
			resources.push({
				id: `github-environment:${packageId}:${environmentName}`,
				kind: 'github-environment',
				provider: 'github',
				environment,
				packageId,
				serviceId: null,
				logicalName: `${packageId} ${environmentName}`,
				dependencies: [`package-workflow:${packageId}`],
					spec: {
						packageId,
						packageRoot: adapter.dir,
						repository,
						environment: environmentName,
					},
				source: { type: 'package-adapter', id: packageId },
			});
			for (const secretName of packageRequiredSecretsForGitHubEnvironment(adapter, environmentName)) {
				resources.push({
					id: `github-secret-binding:${packageId}:${environmentName}:${secretName}`,
					kind: 'github-secret-binding',
					provider: 'github',
					environment,
					packageId,
					serviceId: null,
					logicalName: `${packageId} ${environmentName} ${secretName}`,
					dependencies: [`github-environment:${packageId}:${environmentName}`],
					spec: {
						packageId,
						packageRoot: adapter.dir,
						repository,
						environment: environmentName,
						secretName,
						envName: secretName,
					},
					source: { type: 'package-adapter', id: packageId },
				});
			}
			for (const variableName of packageRequiredVariablesForGitHubEnvironment(adapter, environmentName)) {
				resources.push({
					id: `github-variable-binding:${packageId}:${environmentName}:${variableName}`,
					kind: 'github-variable-binding',
					provider: 'github',
					environment,
					packageId,
					serviceId: null,
					logicalName: `${packageId} ${environmentName} ${variableName}`,
					dependencies: [`github-environment:${packageId}:${environmentName}`],
					spec: {
						packageId,
						packageRoot: adapter.dir,
						repository,
						environment: environmentName,
						variableName,
						envName: variableName,
					},
					source: { type: 'package-adapter', id: packageId },
				});
			}
		}
	}
	for (const artifact of adapter.artifacts) {
		if (artifact.provider !== 'docker') continue;
		const dockerfile = artifact.dockerfile ?? 'Dockerfile';
		const context = artifact.context ?? '.';
		const platforms = dockerPlatforms(artifact.architectures, adapter.metadata.dockerImageArchitectures);
		const localBuildPlatforms = environment === 'local' ? [localDockerPlatform()] : platforms;
		const branch = environment === 'prod' ? 'main' : 'staging';
		const configuredTags = stringRecord(dockerImageConfig.tags);
		const imageTagTemplates = environment === 'prod'
			? stringArray(configuredTags.release).length > 0 ? stringArray(configuredTags.release) : ['<version>']
			: [];
		const imageTags = materializeDockerImageTags(imageTagTemplates, adapter, branch);
		const workflowSpec = repository
			? {
				packageId,
				repository,
				workflow: dockerWorkflow,
				branch,
				inputs: {
					image: artifact.name,
					...(artifact.target ? { target: artifact.target } : {}),
				},
				wait: environment === 'prod',
			}
			: null;
		resources.push({
			id: `package-image:${artifact.name}`,
			kind: 'package-image',
			provider: 'dockerhub',
			environment,
			packageId,
			serviceId: null,
			logicalName: artifact.name,
			dependencies: [`package-workflow:${packageId}`],
			spec: {
				packageId,
				packageRoot: adapter.dir,
				repository,
				image: artifact.name,
				role: artifact.role ?? null,
				tags: imageTags,
				architectures: platforms,
				workflow: dockerWorkflow,
				workflowDispatch: workflowSpec,
				requiredSecrets: ['TREESEED_DOCKERHUB_TOKEN'],
				requiredVariables: ['TREESEED_DOCKERHUB_USERNAME'],
			},
			source: { type: 'package-adapter', id: packageId },
		});
		resources.push({
			id: `docker-image-build:${artifact.name}`,
			kind: 'docker-image-build',
			provider: 'docker',
			environment,
			packageId,
			serviceId: null,
			logicalName: artifact.name,
			dependencies: [`package-manifest:${packageId}`],
			spec: {
				packageId,
				packageRoot: adapter.dir,
				image: artifact.name,
				dockerfile,
				context,
				prepareCommand: packageId === '@treeseed/agent'
					? {
						command: 'bash',
						args: ['-lc', 'ulimit -n 65535 2>/dev/null || true; npm run capacity-provider:build -- --prepare-only'],
					}
					: null,
				target: artifact.target ?? null,
				role: artifact.role ?? null,
				platforms: localBuildPlatforms,
				tags: imageTags.map((tag) => `${artifact.name}:${tag}`),
				labels: {
					'org.opencontainers.image.source': repository ? `https://github.com/${repository}` : adapter.relativeDir,
					'org.treeseed.package': packageId,
				},
				buildArgs: {},
				push: false,
				load: true,
				provenance: false,
				workflow: dockerWorkflow,
			},
			source: { type: 'package-adapter', id: packageId },
		});
	}
	return resources;
}

export function templateResources(templates: TreeseedTemplateUnit[], environment: TreeseedDesiredEnvironment): TreeseedDesiredResource[] {
	return templates.map((template) => ({
		id: `template-manifest:${template.id}`,
		kind: 'template-manifest' as const,
		provider: 'treeseed',
		environment,
		packageId: template.id,
		serviceId: null,
		logicalName: `${template.name} template manifest`,
		dependencies: [],
		spec: {
			templateId: template.id,
			templateName: template.name,
			category: template.category,
			templateRoot: template.path,
			manifestPath: template.manifestPath,
			version: template.version,
			repository: template.repository,
			releaseTag: template.releaseTag,
			recordPath: template.recordPath,
		},
		source: { type: 'package-adapter' as const, id: `template:${template.id}` },
	}));
}
