import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
	discoverTreeseedPackageAdapters,
	type TreeseedPackageAdapter,
} from '../operations/services/package-adapters.ts';
import { resolveCapacityProviderLaunchPlan } from '../capacity-provider.ts';
import { workspaceRoot } from '../operations/services/workspace-tools.ts';
import {
	checkedOutTemplateRepositories,
	type TreeseedTemplateRepositoryManifest,
} from '../operations/services/managed-repositories.ts';
import { deriveTreeseedDesiredUnits } from '../reconcile/desired-state.ts';
import type { TreeseedDesiredUnit, TreeseedReconcileSelector, TreeseedReconcileTarget } from '../reconcile/contracts.ts';
import {
	buildProjectLocalContentResources,
	type TreeseedLocalContentMode,
} from './local-content-materialization.ts';

export type TreeseedDesiredEnvironment = 'local' | 'staging' | 'prod';

export type TreeseedPackageUnit = {
	id: string;
	name: string;
	kind: string;
	path: string;
	version: string | null;
	publishTarget: string | null;
	manifestPath: string | null;
	releaseCapability: 'npm' | 'image' | 'deploy-only' | 'none';
};

export type TreeseedTemplateUnit = {
	id: string;
	name: string;
	category: string;
	path: string;
	version: string | null;
	repository: string | null;
	manifestPath: string | null;
	releaseTag: string | null;
	recordPath: string;
};

export type TreeseedDesiredResourceKind =
	| 'package-manifest'
	| 'template-manifest'
	| 'package-workflow'
	| 'package-image'
	| 'github-environment'
	| 'github-secret-binding'
	| 'docker-image-build'
	| 'cloudflare-resource'
	| 'railway-project'
	| 'railway-environment'
	| 'railway-service'
	| 'railway-volume'
	| 'railway-domain'
	| 'local-process'
	| 'local-docker-compose'
	| 'local-treedx'
	| 'local-content-materialization'
	| 'capacity-provider'
	| 'branch-preview'
	| 'branch-preview-cleanup'
	| 'workflow-gate'
	| 'save-gate'
	| 'release-gate';

export type TreeseedDesiredResource = {
	id: string;
	kind: TreeseedDesiredResourceKind;
	provider: string;
	environment: TreeseedDesiredEnvironment;
	packageId: string | null;
	serviceId: string | null;
	logicalName: string;
	dependencies: string[];
	spec: Record<string, unknown>;
	source: {
		type: 'reconcile-unit' | 'package-adapter';
		id: string;
	};
};

function resolveLocalGitCommonDir(tenantRoot: string) {
	const dotGitPath = resolvePath(tenantRoot, '.git');
	if (!existsSync(dotGitPath)) return '';
	try {
		if (statSync(dotGitPath).isDirectory()) return dotGitPath;
		const stat = readFileSync(dotGitPath, 'utf8');
		const match = /^gitdir:\s*(.+)\s*$/imu.exec(stat);
		if (!match?.[1]) return dotGitPath;
		const gitDir = resolvePath(tenantRoot, match[1].trim());
		const commonDirPath = resolvePath(gitDir, 'commondir');
		if (existsSync(commonDirPath)) {
			const commonDir = readFileSync(commonDirPath, 'utf8').trim();
			if (commonDir) return resolvePath(gitDir, commonDir);
		}
		const marker = `${resolvePath('/').replace(/\/$/u, '')}.git/worktrees/`;
		const normalized = gitDir.replace(/\\/gu, '/');
		const markerIndex = normalized.indexOf('/.git/worktrees/');
		if (markerIndex >= 0) return normalized.slice(0, markerIndex + '/.git'.length);
		if (normalized.includes(marker)) return normalized.slice(0, normalized.indexOf(marker) + '/.git'.length);
		return dirname(gitDir);
	} catch {
		return '';
	}
}

export type TreeseedDesiredResourceEdge = {
	from: string;
	to: string;
	reason: 'depends-on' | 'releases' | 'hosts';
};

export type TreeseedDesiredResourceGraph = {
	workspaceId: string;
	environment: TreeseedDesiredEnvironment;
	packages: TreeseedPackageUnit[];
	templates: TreeseedTemplateUnit[];
	resources: TreeseedDesiredResource[];
	edges: TreeseedDesiredResourceEdge[];
	fingerprints: Record<string, string>;
};

function hashJson(value: unknown) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function reconcileIdentityForGraph(workspaceId: string, environment: TreeseedDesiredEnvironment): TreeseedDesiredUnit['identity'] {
	return {
		teamId: workspaceId,
		projectId: workspaceId,
		slug: workspaceId,
		environment,
		deploymentKey: `${workspaceId}:${environment}`,
		environmentKey: environment,
	};
}

function environmentFromTarget(target: TreeseedReconcileTarget): TreeseedDesiredEnvironment {
	if (target.kind === 'persistent') return target.scope;
	return 'staging';
}

function packageReleaseCapability(adapter: TreeseedPackageAdapter): TreeseedPackageUnit['releaseCapability'] {
	if (adapter.artifacts.some((artifact) => artifact.provider === 'docker')) return 'image';
	if (adapter.artifacts.some((artifact) => artifact.provider === 'npm')) return 'npm';
	if (adapter.releaseChecks.length > 0) return 'deploy-only';
	return 'none';
}

function packageUnitFromAdapter(adapter: TreeseedPackageAdapter): TreeseedPackageUnit {
	return {
		id: adapter.id,
		name: adapter.name,
		kind: adapter.kind,
		path: adapter.relativeDir,
		version: adapter.version,
		publishTarget: adapter.publishTarget,
		manifestPath: adapter.manifestPath,
		releaseCapability: packageReleaseCapability(adapter),
	};
}

function templateReleaseTag(manifest: TreeseedTemplateRepositoryManifest) {
	return manifest.version ? `${manifest.release.tagPrefix}${manifest.id}/v${manifest.version}` : null;
}

function templateUnitFromRepository(repo: ReturnType<typeof checkedOutTemplateRepositories>[number]): TreeseedTemplateUnit {
	const manifest = repo.templateManifest!;
	return {
		id: manifest.id,
		name: manifest.name,
		category: manifest.category,
		path: repo.relativeDir,
		version: manifest.version,
		repository: manifest.repository,
		manifestPath: manifest.manifestPath,
		releaseTag: templateReleaseTag(manifest),
		recordPath: manifest.release.recordPath,
	};
}

function stringRecord(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown) {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function workflowName(value: unknown, fallback: string) {
	return (typeof value === 'string' && value.trim() ? value.trim() : fallback).replace(/^\.github\/workflows\//u, '');
}

function packageShortSha(adapter: TreeseedPackageAdapter) {
	const envSha = process.env.GITHUB_SHA;
	if (typeof envSha === 'string' && /^[a-f0-9]{7,40}$/iu.test(envSha)) return envSha.slice(0, 12).toLowerCase();
	return createHash('sha256').update(`${adapter.id}:${adapter.dir}:${adapter.version ?? ''}`).digest('hex').slice(0, 12);
}

function materializeDockerImageTags(tags: string[], adapter: TreeseedPackageAdapter, branch: string) {
	const shortSha = packageShortSha(adapter);
	const branchSlug = branch.replace(/[^A-Za-z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'branch';
	return tags.map((tag) => tag
		.replace(/<short-sha>/gu, shortSha)
		.replace(/<branch-slug>/gu, branchSlug)
		.replace(/<branch>/gu, branchSlug)
		.replace(/<version>/gu, String(adapter.version ?? 'latest').replace(/[^A-Za-z0-9_.-]+/gu, '-')));
}

function dockerPlatforms(artifactArchitectures: unknown, adapterArchitectures: unknown) {
	const architectures = stringArray(artifactArchitectures).length > 0
		? stringArray(artifactArchitectures)
		: stringArray(adapterArchitectures);
	const normalized = architectures.length > 0 ? architectures : ['amd64', 'arm64'];
	return normalized.map((arch) => arch.startsWith('linux/') ? arch : `linux/${arch}`);
}

function localDockerPlatform() {
	if (process.arch === 'arm64') return 'linux/arm64';
	if (process.arch === 'arm') return 'linux/arm/v7';
	return 'linux/amd64';
}

function safeTreeDxRepositoryName(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_.-]+/gu, '-')
		.replace(/^-+|-+$/gu, '') || 'project';
}

function localTreeDxContentProjects(tenantRoot: string) {
	const seedPath = resolvePath(tenantRoot, 'seeds', 'treeseed.yaml');
	if (!existsSync(seedPath)) return [];
	const parsed = parseYaml(readFileSync(seedPath, 'utf8')) as unknown;
	const resources = stringRecord((parsed as Record<string, unknown> | null)?.resources);
	const projects = Array.isArray(resources.projects) ? resources.projects : [];
	return projects.flatMap((entry) => {
		const project = stringRecord(entry);
		const slug = typeof project.slug === 'string' && project.slug.trim() ? project.slug.trim() : '';
		const repository = stringRecord(project.repository);
		const architecture = stringRecord(project.architecture);
		const contentPath = typeof architecture.contentPath === 'string' && architecture.contentPath.trim()
			? architecture.contentPath.trim()
			: null;
		if (!slug || !contentPath) return [];
		const checkoutPath = typeof repository.checkoutPath === 'string' && repository.checkoutPath.trim()
			? repository.checkoutPath.trim()
			: '.';
		return [{
			projectKey: typeof project.key === 'string' ? project.key : `project:treeseed/${slug}`,
			slug,
			repositoryName: safeTreeDxRepositoryName(`treeseed-${slug}`),
			repositoryId: safeTreeDxRepositoryName(`treeseed-${slug}`),
			localRoot: checkoutPath === '.' ? tenantRoot : resolvePath(tenantRoot, checkoutPath),
			contentPath,
			defaultRef: 'refs/heads/main',
			seedPaths: [
				`${contentPath.replace(/\/+$/u, '')}/objectives`,
				`${contentPath.replace(/\/+$/u, '')}/agents`,
			],
		}];
	});
}

function releasePhaseForEnvironment(environment: TreeseedDesiredEnvironment) {
	return environment === 'prod' ? 'release' : 'stage';
}

function resourceKindForUnit(unit: TreeseedDesiredUnit): TreeseedDesiredResourceKind {
	if (unit.provider === 'railway') {
		if (unit.unitType.startsWith('railway-service:')) return 'railway-service';
		if (unit.unitType === 'custom-domain:api') return 'railway-domain';
	}
	if (unit.provider === 'cloudflare' || unit.provider === 'cloudflare-dns') return 'cloudflare-resource';
	if (unit.provider === 'treeseed' && /runtime$/u.test(unit.unitType)) return 'release-gate';
	return 'cloudflare-resource';
}

function serviceIdForUnit(unit: TreeseedDesiredUnit) {
	const serviceKey = unit.metadata.serviceKey;
	if (typeof serviceKey === 'string' && serviceKey.trim()) return serviceKey;
	if (unit.unitType.startsWith('railway-service:')) return unit.unitType.slice('railway-service:'.length);
	return null;
}

function packageIdForUnit(unit: TreeseedDesiredUnit) {
	const app = unit.metadata.applicationId ?? unit.metadata.packageId;
	return typeof app === 'string' && app.trim() ? app : null;
}

function resourceFromUnit(unit: TreeseedDesiredUnit, environment: TreeseedDesiredEnvironment): TreeseedDesiredResource {
	return {
		id: unit.unitId,
		kind: resourceKindForUnit(unit),
		provider: unit.provider,
		environment,
		packageId: packageIdForUnit(unit),
		serviceId: serviceIdForUnit(unit),
		logicalName: unit.logicalName,
		dependencies: unit.dependencies,
		spec: {
			unitType: unit.unitType,
			identity: unit.identity,
			target: unit.target,
			spec: unit.spec,
			secrets: Object.keys(unit.secrets),
			metadata: unit.metadata,
		},
		source: {
			type: 'reconcile-unit',
			id: unit.unitId,
		},
	};
}

function packageResources(adapter: TreeseedPackageAdapter, environment: TreeseedDesiredEnvironment): TreeseedDesiredResource[] {
	const resources: TreeseedDesiredResource[] = [];
	const packageId = adapter.id;
	const repository = typeof adapter.metadata.repository === 'string' ? adapter.metadata.repository : null;
	const dockerImageConfig = stringRecord(adapter.metadata.dockerImages);
	const dockerWorkflow = workflowName(
		environment === 'prod'
			? dockerImageConfig.releaseWorkflow
			: adapter.metadata.developmentImageWorkflow,
		environment === 'prod' ? 'publish.yml' : 'dev-image.yml',
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
			for (const secretName of Array.isArray(adapter.metadata.requiredSecrets) ? adapter.metadata.requiredSecrets : []) {
				if (typeof secretName !== 'string' || !secretName.trim()) continue;
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
		}
	}
	for (const artifact of adapter.artifacts) {
		if (artifact.provider !== 'docker') continue;
		const dockerfile = artifact.dockerfile ?? 'Dockerfile';
		const context = artifact.context ?? '.';
		const platforms = dockerPlatforms(artifact.architectures, adapter.metadata.developmentImageArchitectures);
		const localBuildPlatforms = environment === 'local' ? [localDockerPlatform()] : platforms;
		const branch = environment === 'prod' ? 'main' : 'staging';
		const configuredTags = stringRecord(dockerImageConfig.tags);
		const imageTagTemplates = environment === 'prod'
			? stringArray(configuredTags.release).length > 0 ? stringArray(configuredTags.release) : ['<version>']
			: stringArray(configuredTags.staging).length > 0 ? stringArray(configuredTags.staging) : [
				`dev-${branch}-<short-sha>`,
				`dev-${branch}`,
			];
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

function templateResources(templates: TreeseedTemplateUnit[], environment: TreeseedDesiredEnvironment): TreeseedDesiredResource[] {
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

function localDevelopmentResources(tenantRoot: string, environment: TreeseedDesiredEnvironment, localContent: TreeseedLocalContentMode): TreeseedDesiredResource[] {
	if (environment !== 'local') return [];
	const composeId = 'local-docker-compose:agent-capacity-provider';
	const treeDxComposeId = 'local-docker-compose:treedx';
	const apiPostgresComposeId = 'local-docker-compose:api-postgres';
	const capacityProviderDataDir = resolvePath(tenantRoot, '.treeseed/local-capacity-provider/data');
	const localGitCommonDir = resolveLocalGitCommonDir(tenantRoot);
	const hostCodexAuthFile = [
		process.env.TREESEED_CODEX_AUTH_FILE,
		process.env.CODEX_AUTH_FILE,
		process.env.HOME ? resolvePath(process.env.HOME, '.codex/auth.json') : '',
	].find((candidate) => candidate && existsSync(candidate)) ?? '';
	const capacityPlan = resolveCapacityProviderLaunchPlan({
		schemaVersion: 1,
			provider: {
				dataDir: capacityProviderDataDir,
				environment: 'local',
				market: {
					url: 'http://host.docker.internal:3000',
					id: 'local',
				},
			},
		runtime: {
			images: {
				roles: {
					manager: { image: 'treeseed/agent-manager', tag: 'latest' },
					runner: { image: 'treeseed/agent-runner', tag: 'latest' },
				},
			},
		},
	} as any);
	const localTreeDxApiEnv = {
		TREESEED_TREEDX_JWT_ISSUER: 'https://api.treeseed.local/treedx',
		TREESEED_TREEDX_JWT_AUDIENCE: 'treedx-local',
		TREESEED_TREEDX_JWT_HS256_SECRET: 'treeseed-local-treedx-jwt-secret',
		TREESEED_TREEDX_PROXY_ACTOR_ID: 'treeseed-api',
		TREESEED_TREEDX_PROXY_TENANT_ID: 'treeseed-control-plane',
	};
	const localCapacityProviderTreeDxEnv = {
		TREESEED_TREEDX_BASE_URL: 'http://host.docker.internal:4000',
		TREESEED_TREEDX_URL: 'http://host.docker.internal:4000',
		...localTreeDxApiEnv,
	};
	const localCapacityProviderEnv = {
		...capacityPlan.composeEnv,
		...localCapacityProviderTreeDxEnv,
		TREESEED_PROVIDER_HOST_DATA_DIR: capacityProviderDataDir,
		...(hostCodexAuthFile ? {
			TREESEED_HOST_CODEX_AUTH_FILE: hostCodexAuthFile,
			TREESEED_CODEX_AUTH_FILE: '/data/codex/auth.json',
		} : {}),
		...(localGitCommonDir ? {
			TREESEED_PROVIDER_WORKSPACE_ABSOLUTE_CONTAINER: tenantRoot,
			TREESEED_PROVIDER_WORKSPACE_GITDIR_CONTAINER: `/.treeseed/worktrees/${basename(tenantRoot)}`,
			TREESEED_MARKET_GIT_COMMON_DIR_HOST: localGitCommonDir,
			TREESEED_MARKET_GIT_COMMON_DIR_ABSOLUTE_CONTAINER: localGitCommonDir,
			TREESEED_MARKET_GIT_COMMON_DIR_ROOT_CONTAINER: '/.git',
		} : {}),
		TREESEED_PROVIDER_CONTAINER_UID: String(process.getuid?.() ?? 1000),
		TREESEED_PROVIDER_CONTAINER_GID: String(process.getgid?.() ?? 1000),
		TREESEED_CAPACITY_PROVIDER_API_KEY: 'tsp_local_treeseed_demo_capacity_provider',
		TREESEED_CAPACITY_PROVIDER_ID: 'treeseed-local-dev',
		TREESEED_CAPACITY_PROVIDER_TEAM_ID: 'treeseed',
		TREESEED_MANAGEMENT_API_URL: 'http://host.docker.internal:3000',
	};
	return [
		{
			id: apiPostgresComposeId,
			kind: 'local-docker-compose',
			provider: 'local',
			environment,
			packageId: '@treeseed/api',
			serviceId: 'api-postgres',
			logicalName: 'local API PostgreSQL compose',
			dependencies: [],
			spec: {
				composeFile: 'packages/api/compose.postgres.yml',
				projectName: 'treeseed-local-api-postgres',
				cwd: '.',
				dataDir: '.treeseed/local-api-postgres/data',
				env: {
					TREESEED_LOCAL_POSTGRES_PASSWORD: 'treeseed-local-dev',
					TREESEED_LOCAL_POSTGRES_PORT: '54329',
				},
				ports: [{ host: 54329, container: 5432 }],
				volumes: [{ name: 'treeseed-api-postgres-volume', mountPath: '/var/lib/postgresql/data', sharedLocalOnly: true }],
				healthChecks: [
					{ id: 'api-postgres-compose', kind: 'container', service: 'treeseed-api-postgres' },
				],
			},
			source: { type: 'package-adapter', id: '@treeseed/api' },
		},
		{
			id: 'local-treedx:team-primary',
			kind: 'local-treedx',
			provider: 'local',
			environment,
			packageId: 'treedx',
			serviceId: 'treedx',
			logicalName: 'local TreeDX team content repository plane',
			dependencies: [treeDxComposeId],
			spec: {
				mode: 'private-team',
				contentRepositoryAccessMode: 'treedx',
				siteRepositoryAccessMode: 'filesystem',
				projectRepositoryAccessMode: 'filesystem',
				baseUrl: 'http://127.0.0.1:4000',
				dataDir: '.treeseed/local-treedx/data',
				healthEndpoint: 'http://127.0.0.1:4000/api/v1/health',
				auth: localTreeDxApiEnv,
				projects: localTreeDxContentProjects(tenantRoot),
			},
			source: { type: 'package-adapter', id: 'treedx' },
		},
		{
			id: treeDxComposeId,
			kind: 'local-docker-compose',
			provider: 'local',
			environment,
			packageId: 'treedx',
			serviceId: 'treedx',
			logicalName: 'local TreeDX compose',
			dependencies: [],
			spec: {
				composeFile: 'packages/treedx/compose.yaml',
				projectName: 'treeseed-local-treedx',
				cwd: 'packages/treedx',
				dataDir: '.treeseed/local-treedx/data',
				ports: [{ host: 4000, container: 4000 }],
				env: {
					TREEDX_ALLOW_DEV_VERIFIER_IN_PROD: 'true',
					...localTreeDxApiEnv,
				},
				volumes: [{ name: 'treeseed-local-treedx-data', mountPath: '/data', sharedLocalOnly: true }],
				healthChecks: [
					{ id: 'treedx-api', kind: 'http', url: 'http://127.0.0.1:4000/api/v1/health' },
				],
			},
			source: { type: 'package-adapter', id: 'treedx' },
		},
		{
			id: 'capacity-provider:local',
			kind: 'capacity-provider',
			provider: 'local',
			environment,
			packageId: '@treeseed/agent',
			serviceId: 'capacity-provider',
			logicalName: 'local capacity provider',
			dependencies: [composeId],
			spec: {
				mode: 'local',
				roles: ['api', 'manager', 'runner'],
				volumePolicy: 'shared-local',
				healthEndpoint: 'http://127.0.0.1:4783/healthz',
			},
			source: { type: 'package-adapter', id: '@treeseed/agent' },
		},
		{
			id: composeId,
			kind: 'local-docker-compose',
			provider: 'local',
			environment,
			packageId: '@treeseed/agent',
			serviceId: 'agent-capacity-provider',
			logicalName: 'agent capacity provider compose',
			dependencies: ['local-process:api', treeDxComposeId],
			spec: {
				composeFile: 'packages/agent/compose.capacity-provider.yml',
				composeFiles: [
					'packages/agent/compose.capacity-provider.yml',
					'packages/agent/compose.capacity-provider.dev.yml',
				],
				projectName: 'treeseed-capacity-provider',
				cwd: '.',
				dataDir: '.treeseed/local-capacity-provider/data',
				buildPolicy: 'missing',
				devMode: 'typescript',
				redactedEnv: capacityPlan.redactedEnv,
				envKeys: Object.keys(localCapacityProviderEnv).sort(),
				env: localCapacityProviderEnv,
				services: ['agent-manager', 'agent-runner'],
				volumes: [{ name: 'treeseed-capacity-provider-data', mountPath: '/data', sharedLocalOnly: true }],
				healthChecks: [
					{ id: 'compose-services', kind: 'container', service: 'agent-manager' },
				],
			},
			source: { type: 'package-adapter', id: '@treeseed/agent' },
		},
		...[
			['market-web', 'Market web dev process'],
			['api', 'API dev process'],
			['operations-runner', 'Operations runner dev process'],
		].map(([id, label]) => ({
			id: `local-process:${id}`,
			kind: 'local-process' as const,
			provider: 'local',
			environment,
			packageId: id === 'market-web' ? '@treeseed/market' : '@treeseed/api',
			serviceId: id,
			logicalName: label,
			dependencies: id === 'market-web'
				? ['local-process:api']
				: id === 'api'
					? [apiPostgresComposeId]
					: ['local-process:api'],
			spec: {
				processId: id,
				surfaces: id === 'market-web' ? ['web'] : id === 'api' ? ['api'] : ['operations-runner'],
				supervisor: 'sdk-managed-dev',
				action: 'start',
				options: {
					apiPort: 3000,
				},
				stateDir: '.treeseed/dev',
				logDir: '.treeseed/logs',
				cwd: id === 'market-web' ? '.' : 'packages/api',
			},
			source: { type: 'package-adapter' as const, id },
		})),
		...buildProjectLocalContentResources({ tenantRoot, environment, localContent }),
	];
}

function releaseGateResources(packages: TreeseedPackageUnit[], templates: TreeseedTemplateUnit[], environment: TreeseedDesiredEnvironment): TreeseedDesiredResource[] {
	const phase = releasePhaseForEnvironment(environment);
	const hostedEnvironment = environment === 'prod' ? 'prod' : 'staging';
	const packageGates = packages.flatMap((pkg) => {
		const fingerprint = hashJson({ packageId: pkg.id, version: pkg.version, capability: pkg.releaseCapability, environment, phase });
		const verifyGate: TreeseedDesiredResource = {
			id: `release-gate:verify:${pkg.id}`,
			kind: 'release-gate',
			provider: 'treeseed',
			environment,
			packageId: pkg.id,
			serviceId: null,
			logicalName: `${pkg.id} verify gate`,
			dependencies: [`package-manifest:${pkg.id}`],
			spec: {
				gateKind: 'release-gate:verify',
				phase,
				packageId: pkg.id,
				environment: hostedEnvironment,
				fingerprint,
				capability: pkg.releaseCapability,
				command: 'verify.release',
			},
			source: { type: 'package-adapter', id: pkg.id },
		};
		const publishGateKind = pkg.releaseCapability === 'npm'
			? 'release-gate:npm-publish'
			: pkg.releaseCapability === 'image'
				? 'release-gate:image-publish'
				: null;
		return [
			verifyGate,
			...(publishGateKind ? [{
				id: `${publishGateKind}:${pkg.id}`,
				kind: 'release-gate' as const,
				provider: 'treeseed',
				environment,
				packageId: pkg.id,
				serviceId: null,
				logicalName: `${pkg.id} publish gate`,
				dependencies: [verifyGate.id],
				spec: {
					gateKind: publishGateKind,
					phase,
					packageId: pkg.id,
					environment: hostedEnvironment,
					fingerprint: hashJson({ publishGateKind, packageId: pkg.id, version: pkg.version, environment, phase }),
					capability: pkg.releaseCapability,
				},
				source: { type: 'package-adapter' as const, id: pkg.id },
			}] : []),
		];
	});
	const templateGates = templates.flatMap((template) => {
		const verifyGate: TreeseedDesiredResource = {
			id: `release-gate:template-verify:${template.id}`,
			kind: 'release-gate',
			provider: 'treeseed',
			environment,
			packageId: template.id,
			serviceId: null,
			logicalName: `${template.name} template verify gate`,
			dependencies: [`template-manifest:${template.id}`],
			spec: {
				gateKind: 'release-gate:template-verify',
				phase,
				templateId: template.id,
				environment: hostedEnvironment,
				fingerprint: hashJson({ templateId: template.id, version: template.version, repository: template.repository, environment, phase }),
				releaseTag: template.releaseTag,
				recordPath: template.recordPath,
			},
			source: { type: 'package-adapter' as const, id: `template:${template.id}` },
		};
		return [
			verifyGate,
			{
				id: `release-gate:template-release-record:${template.id}`,
				kind: 'release-gate' as const,
				provider: 'treeseed',
				environment,
				packageId: template.id,
				serviceId: null,
				logicalName: `${template.name} template release record`,
				dependencies: [verifyGate.id],
				spec: {
					gateKind: 'release-gate:template-release-record',
					phase,
					templateId: template.id,
					environment: hostedEnvironment,
					fingerprint: hashJson({ gate: 'template-release-record', templateId: template.id, version: template.version, releaseTag: template.releaseTag, environment, phase }),
					releaseTag: template.releaseTag,
					recordPath: template.recordPath,
				},
				source: { type: 'package-adapter' as const, id: `template:${template.id}` },
			},
		];
	});
	const releaseDependencies = [...packageGates.map((gate) => gate.id), ...templateGates.map((gate) => gate.id)];
	return [
		...packageGates,
		...templateGates,
		{
			id: `release-gate:hosted-reconcile:${hostedEnvironment}:all`,
			kind: 'release-gate',
			provider: 'treeseed',
			environment,
			packageId: null,
			serviceId: 'hosted-reconcile',
			logicalName: `${hostedEnvironment} hosted reconciliation gate`,
			dependencies: releaseDependencies,
			spec: {
				gateKind: 'release-gate:hosted-reconcile',
				phase,
				environment: hostedEnvironment,
				appId: 'all',
				fingerprint: hashJson({ gate: 'hosted-reconcile', environment: hostedEnvironment, packages, templates }),
				hostedSelector: {
					environment: hostedEnvironment,
					provider: ['cloudflare', 'cloudflare-dns', 'railway'],
				},
			},
			source: { type: 'package-adapter', id: 'release' },
		},
		{
			id: `release-gate:live-verify:${hostedEnvironment}:all`,
			kind: 'release-gate',
			provider: 'treeseed',
			environment,
			packageId: null,
			serviceId: 'live-verify',
			logicalName: `${hostedEnvironment} live verification gate`,
			dependencies: [`release-gate:hosted-reconcile:${hostedEnvironment}:all`],
			spec: {
				gateKind: 'release-gate:live-verify',
				phase,
				environment: hostedEnvironment,
				appId: 'all',
				fingerprint: hashJson({ gate: 'live-verify', environment: hostedEnvironment, packages, templates }),
				hostedSelector: {
					environment: hostedEnvironment,
					provider: ['cloudflare', 'cloudflare-dns', 'railway'],
				},
			},
			source: { type: 'package-adapter', id: 'release' },
		},
		{
			id: environment === 'prod' ? 'release-gate:production-record:prod' : 'release-gate:candidate-record:staging',
			kind: 'release-gate',
			provider: 'treeseed',
			environment,
			packageId: null,
			serviceId: environment === 'prod' ? 'production-record' : 'candidate-record',
			logicalName: environment === 'prod' ? 'production release record' : 'staging candidate record',
			dependencies: [`release-gate:live-verify:${hostedEnvironment}:all`],
			spec: {
				gateKind: environment === 'prod' ? 'release-gate:production-record' : 'release-gate:candidate-record',
				phase,
				environment,
				fingerprint: hashJson({ gate: environment === 'prod' ? 'production-record' : 'candidate-record', packages, templates }),
				recordPath: environment === 'prod'
					? '.treeseed/workflow/releases/latest-production.json'
					: '.treeseed/workflow/release-candidates/latest-staging.json',
			},
			source: { type: 'package-adapter', id: 'release' },
		},
	];
}

function slugBranchName(branchName: string) {
	return branchName
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 48) || 'preview';
}

function branchPreviewResources(target: TreeseedReconcileTarget, environment: TreeseedDesiredEnvironment): TreeseedDesiredResource[] {
	if (target.kind !== 'branch') return [];
	const branchSlug = slugBranchName(target.branchName);
	const previewId = `branch-preview:${branchSlug}:web`;
	return [
		{
			id: previewId,
			kind: 'branch-preview',
			provider: 'treeseed',
			environment,
			packageId: '@treeseed/market',
			serviceId: 'market-web',
			logicalName: `Branch preview for ${target.branchName}`,
			dependencies: [],
			spec: {
				branch: target.branchName,
				branchSlug,
				environment: 'staging',
				appId: 'web',
				host: 'cloudflare',
				ttlHours: 72,
				resources: {
					environment: 'staging',
					appId: ['web'],
					provider: ['cloudflare', 'cloudflare-dns'],
				},
			},
			source: { type: 'package-adapter', id: 'branch-preview' },
		},
		{
			id: `branch-preview-cleanup:${branchSlug}:web`,
			kind: 'branch-preview-cleanup',
			provider: 'treeseed',
			environment,
			packageId: '@treeseed/market',
			serviceId: 'market-web',
			logicalName: `Branch preview cleanup for ${target.branchName}`,
			dependencies: [previewId],
			spec: {
				branch: target.branchName,
				branchSlug,
				environment: 'staging',
				reason: 'manual',
				selector: {
					environment: 'staging',
					unitId: [previewId],
				},
			},
			source: { type: 'package-adapter', id: 'branch-preview-cleanup' },
		},
	];
}

function resourceMatchesSelector(resource: TreeseedDesiredResource, selector?: TreeseedReconcileSelector) {
	if (!selector) return true;
	const has = (values: string[] | undefined, candidates: Array<string | null>) => {
		const normalized = new Set((values ?? []).map((value) => value.trim()).filter(Boolean));
		return normalized.size === 0 || candidates.some((candidate) => candidate != null && normalized.has(candidate));
	};
	return has(selector.host ?? selector.provider, [resource.provider])
		&& has(selector.packageId, [resource.packageId])
		&& has(selector.serviceId, [resource.serviceId, resource.logicalName])
		&& has(selector.resourceKind, [resource.kind])
		&& has(selector.unitId, [resource.id, resource.source.type === 'reconcile-unit' ? resource.source.id : null])
		&& has(selector.serviceType, [typeof resource.spec.unitType === 'string' ? resource.spec.unitType : null]);
}

export function compileTreeseedDesiredResourceGraph({
	tenantRoot = workspaceRoot(),
	target,
	localContent = 'auto',
}: {
	tenantRoot?: string;
	target: TreeseedReconcileTarget;
	localContent?: TreeseedLocalContentMode;
}): TreeseedDesiredResourceGraph {
	const environment = environmentFromTarget(target);
	const derived = deriveTreeseedDesiredUnits({ tenantRoot, target });
	const packageAdapters = discoverTreeseedPackageAdapters(tenantRoot);
	const packages = packageAdapters.map(packageUnitFromAdapter);
	const templates = checkedOutTemplateRepositories(tenantRoot).map(templateUnitFromRepository);
	const resources = [
		...derived.units.map((unit) => resourceFromUnit(unit, environment)),
		...packageAdapters.flatMap((adapter) => packageResources(adapter, environment)),
		...templateResources(templates, environment),
		...localDevelopmentResources(tenantRoot, environment, localContent),
		...branchPreviewResources(target, environment),
		...releaseGateResources(packages, templates, environment),
	];
	const edges: TreeseedDesiredResourceEdge[] = resources.flatMap((resource) =>
		resource.dependencies.map((dependency) => ({
			from: dependency,
			to: resource.id,
			reason: 'depends-on' as const,
		})));
	const fingerprints = Object.fromEntries(resources.map((resource) => [resource.id, hashJson(resource)]));
	return {
		workspaceId: derived.deployConfig.slug,
		environment,
		packages,
		templates,
		resources,
		edges,
		fingerprints,
	};
}

export function selectTreeseedDesiredResources(
	graph: TreeseedDesiredResourceGraph,
	selector?: TreeseedReconcileSelector,
): TreeseedDesiredResourceGraph {
	if (!selector) return graph;
	const selected = graph.resources.filter((resource) => resourceMatchesSelector(resource, selector));
	const selectedIds = new Set(selected.map((resource) => resource.id));
	const include = new Map(selected.map((resource) => [resource.id, resource]));
	const byId = new Map(graph.resources.map((resource) => [resource.id, resource]));
	const visit = (resource: TreeseedDesiredResource) => {
		for (const dependencyId of resource.dependencies) {
			const dependency = byId.get(dependencyId);
			if (!dependency || include.has(dependency.id)) continue;
			include.set(dependency.id, dependency);
			visit(dependency);
		}
	};
	for (const resource of selected) visit(resource);
	const resources = graph.resources.filter((resource) => include.has(resource.id));
	const resourceIds = new Set(resources.map((resource) => resource.id));
	return {
		...graph,
		resources,
		edges: graph.edges.filter((edge) => resourceIds.has(edge.from) && resourceIds.has(edge.to)),
		fingerprints: Object.fromEntries(Object.entries(graph.fingerprints).filter(([id]) => resourceIds.has(id))),
		packages: graph.packages.filter((pkg) =>
			resources.some((resource) => resource.packageId === pkg.id) || selectedIds.size === 0),
		templates: graph.templates.filter((template) =>
			resources.some((resource) => resource.packageId === template.id) || selectedIds.size === 0),
	};
}

export function convertDesiredResourceToReconcileUnit(
	graph: TreeseedDesiredResourceGraph,
	resource: TreeseedDesiredResource,
): TreeseedDesiredUnit | null {
	const identity = reconcileIdentityForGraph(graph.workspaceId, graph.environment);
	if (resource.source.type !== 'reconcile-unit') {
		const unitType = (() => {
			if (resource.kind === 'release-gate') return String(resource.spec.gateKind ?? 'release-gate:verify');
			if (resource.kind === 'save-gate') return String(resource.spec.gateKind ?? 'save-gate:promotion-readiness');
			return resource.kind;
		})();
		return {
			unitId: resource.id,
			unitType: unitType as TreeseedDesiredUnit['unitType'],
			provider: resource.provider,
			identity,
			target: { kind: 'persistent', scope: graph.environment },
			logicalName: resource.logicalName,
			dependencies: resource.dependencies,
			spec: resource.spec,
			secrets: {},
			metadata: {
				resourceKind: resource.kind,
				packageId: resource.packageId,
				serviceId: resource.serviceId,
				source: resource.source,
			},
		};
	}
	const spec = resource.spec;
	const unitType = typeof spec.unitType === 'string' ? spec.unitType : null;
	const resourceIdentity = spec.identity && typeof spec.identity === 'object' ? spec.identity : null;
	const target = spec.target && typeof spec.target === 'object' ? spec.target : { kind: 'persistent', scope: graph.environment };
	const unitSpec = spec.spec && typeof spec.spec === 'object' ? spec.spec : {};
	const metadata = spec.metadata && typeof spec.metadata === 'object' ? spec.metadata : {};
	if (!unitType || !resourceIdentity) return null;
	return {
		unitId: resource.source.id,
		unitType: unitType as TreeseedDesiredUnit['unitType'],
		provider: resource.provider,
		identity: resourceIdentity as TreeseedDesiredUnit['identity'],
		target: target as TreeseedReconcileTarget,
		logicalName: resource.logicalName,
		dependencies: resource.dependencies,
		spec: unitSpec as Record<string, unknown>,
		secrets: {},
		metadata: metadata as Record<string, unknown>,
	};
}

export function compileTreeseedDesiredUnitsFromGraph(
	graph: TreeseedDesiredResourceGraph,
	selector?: TreeseedReconcileSelector,
): TreeseedDesiredUnit[] {
	return selectTreeseedDesiredResources(graph, selector).resources
		.map((resource) => convertDesiredResourceToReconcileUnit(graph, resource))
		.filter((unit): unit is TreeseedDesiredUnit => Boolean(unit));
}
