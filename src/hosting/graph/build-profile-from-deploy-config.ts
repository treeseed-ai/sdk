import { loadTreeseedDeployConfig } from '../../platform/deploy-config.ts';
import { loadTreeseedPlugins } from '../../platform/plugins/runtime.ts';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { resolveTreeseedMachineEnvironmentValues } from '../../operations/services/config-runtime.ts';
import { classifyTreeseedGitMode, runTreeseedGitText } from '../../operations/services/git-runner.ts';
import { apiRailwayDefaultDockerfilePath, apiRailwayDefaultSourceRepo, assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService, railwayEnvironmentQualifiedServiceName, railwayTreeDxServiceName } from '../../operations/services/railway-source-policy.ts';
import { createTreeseedCanonicalReconcileReport, type TreeseedCanonicalAction, type TreeseedCanonicalDrift, type TreeseedCanonicalGraphNode, type TreeseedCanonicalPostcondition } from '../../reconcile/index.ts';
import type { TreeseedRunnableBootstrapSystem } from '../../reconcile/bootstrap-systems.ts';
import { discoverTreeseedApplications, findTreeseedApplication, type TreeseedDiscoveredApplication } from '../apps.ts';
import type {
	TreeseedApplicationHostingProfile,
	TreeseedHostAdapter,
	TreeseedHostProjectGroup,
	TreeseedHostingEnvironment,
	TreeseedHostingGraphFilter,
	TreeseedHostingGraph,
	TreeseedHostingGraphInput,
	TreeseedHostingPlan,
	TreeseedHostingPlacementSummary,
	TreeseedHostingUnit,
	TreeseedServiceInstanceSpec,
	TreeseedServicePlacement,
	TreeseedServiceTypeAdapter,
} from '../contracts.ts';
import {
	createDefaultHostAdapters,
	createDefaultHostingProfiles,
	createDefaultServiceTypeAdapters,
	redactSensitiveConfig,
	sanitizedUnitConfig,
	summarizePlacementStatus,
} from '../builtins.ts';
import { capacityProviderProjectGroupId, capacityProviderProjectGroups, marketProjectGroup, privateTreeDxProjectGroup, publicTreeDxProjectGroup, railwaySourcePolicy } from './railway-source-policy.ts';
import { assertRailwayResourceNames, defaultRailwayImageRefForService, indexedName, mergeRecord, publicTreeDxNodePool, publicTreeDxSourcePolicy, railwayImageRefEnvForService, serviceKeyPlacement, serviceKeyType } from './railway-service-name-max-length.ts';

export function buildProfileFromDeployConfig(input: TreeseedHostingGraphInput): TreeseedApplicationHostingProfile {
	const config = input.deployConfig!;
	const environment = input.environment;
	const services: TreeseedServiceInstanceSpec[] = [];
	const projectGroups = [
		marketProjectGroup(environment, config),
		...capacityProviderProjectGroups(environment, config),
		publicTreeDxProjectGroup(environment, config),
		privateTreeDxProjectGroup(),
	];
	const railwayImageRefEnvKeys = [...new Set([
		...Object.keys(config.services ?? {})
		.map((serviceKey) => railwayImageRefEnvForService(serviceKey))
		.filter((value): value is string => Boolean(value)),
		...(config.hosting?.kind === 'treeseed_control_plane' ? ['TREESEED_PUBLIC_TREEDX_IMAGE_REF'] : []),
	])];
	let railwayImageRefEnv: Record<string, string> = {};
	try {
		railwayImageRefEnv = resolveTreeseedMachineEnvironmentValues(input.configRoot ?? input.tenantRoot, environment, railwayImageRefEnvKeys) as Record<string, string>;
	} catch {
		railwayImageRefEnv = {};
	}
	const launchEnv = mergeRecord<string>(railwayImageRefEnv, process.env as Record<string, string>, input.env);

	if (config.surfaces?.web && config.surfaces.web.enabled !== false) {
		services.push({
			id: 'web',
			label: 'Site Hosting',
			serviceType: 'web-site',
			placement: 'web',
			projectGroupId: environment === 'local' ? undefined : 'treeseed-control-plane',
			config: {
				rootDir: config.surfaces?.web?.rootDir ?? '.',
				publicBaseUrl: config.surfaces?.web?.environments?.[environment]?.baseUrl ?? config.surfaces?.web?.publicBaseUrl ?? null,
				domain: config.surfaces?.web?.environments?.[environment]?.domain ?? null,
				cache: config.surfaces?.web?.cache ?? null,
				cloudflare: config.cloudflare
					? {
						workerName: config.cloudflare.workerName ?? null,
						pages: config.cloudflare.pages ?? null,
					}
					: null,
			},
			environments: {
				local: { hostId: 'local-process', config: { hotReload: true, baseUrl: config.surfaces?.web?.localBaseUrl ?? 'http://127.0.0.1:4321' } },
				staging: { hostId: 'cloudflare', projectGroupId: 'treeseed-control-plane' },
				prod: { hostId: 'cloudflare', projectGroupId: 'treeseed-control-plane' },
			},
		});
	}

	for (const [serviceKey, serviceValue] of Object.entries(config.services ?? {})) {
		const service = serviceValue as Record<string, any> | undefined;
		if (!service || service.enabled === false) continue;
		const serviceType = serviceKeyType(serviceKey, service);
		const placement = serviceKeyPlacement(serviceKey);
		const configuredRailwayProjectName = typeof service.railway?.projectName === 'string' && service.railway.projectName.trim()
			? service.railway.projectName.trim()
			: null;
		const defaultProjectGroup = service.provider === 'railway' || service.railway
			? String(serviceKey).startsWith('capacityProvider') && configuredRailwayProjectName
				? capacityProviderProjectGroupId(configuredRailwayProjectName)
				: 'treeseed-control-plane'
			: undefined;
		const imageRefEnv = railwayImageRefEnvForService(serviceKey);
		const imageRef = service.railway?.imageRef
			?? (input.environment === 'prod' && imageRefEnv ? launchEnv[imageRefEnv] ?? null : null)
			?? defaultRailwayImageRefForService(serviceKey, input.environment)
			?? null;
		const sourcePolicy = railwaySourcePolicy(input, serviceKey, service, imageRef);
		const baseServiceName = service.railway?.serviceName ?? null;
		const environmentConfig = service.environments?.[input.environment];
		const effectiveServiceName = typeof environmentConfig?.serviceName === 'string' && environmentConfig.serviceName.trim()
			? environmentConfig.serviceName.trim()
			: (serviceKey === 'operationsRunner' || isApiRailwaySourcePolicyService({ key: serviceKey, serviceName: baseServiceName })) && baseServiceName
				? railwayEnvironmentQualifiedServiceName(baseServiceName, input.environment)
				: baseServiceName;
		const runnerPool = serviceKey === 'operationsRunner' && service.railway?.runnerPool && typeof service.railway.runnerPool === 'object'
			? service.railway.runnerPool
			: null;
		const instanceCount = runnerPool
			? Math.max(1, Number.parseInt(String(runnerPool.bootstrapCount ?? 1), 10) || 1)
			: 1;
		const maxRunners = runnerPool
			? Math.max(1, Number.parseInt(String(runnerPool.maxRunners ?? instanceCount), 10) || instanceCount)
			: 1;
		if (runnerPool && instanceCount > maxRunners) {
			throw new Error(`services.operationsRunner.railway.runnerPool.bootstrapCount (${instanceCount}) cannot exceed maxRunners (${maxRunners}).`);
		}
		for (let offset = 0; offset < instanceCount; offset += 1) {
			const runnerIndex = offset + 1;
			const instanceId = serviceKey === 'operationsRunner' && runnerIndex > 1
				? `${serviceKey}-${String(runnerIndex).padStart(2, '0')}`
				: serviceKey;
			const instanceServiceName = serviceKey === 'operationsRunner' && effectiveServiceName
				? indexedName(effectiveServiceName, runnerIndex)
				: effectiveServiceName;
			const volumeMountPath = serviceKey === 'operationsRunner'
				? service.railway?.volumeMountPath ?? runnerPool?.volumeMountPath ?? '/data'
				: service.railway?.volumeMountPath ?? null;
			if (instanceServiceName && (service.provider === 'railway' || service.railway)) {
				assertRailwayResourceNames(instanceServiceName, volumeMountPath ? `${instanceServiceName}-volume` : null);
			}
			const environmentBinding = (bindingEnvironment: TreeseedHostingEnvironment) => {
				const configured = service.environments?.[bindingEnvironment] ?? {};
				if (!runnerPool) return configured;
				const configuredName = typeof configured.serviceName === 'string' && configured.serviceName.trim()
					? configured.serviceName.trim()
					: baseServiceName
						? railwayEnvironmentQualifiedServiceName(baseServiceName, bindingEnvironment)
						: instanceServiceName;
				const serviceName = configuredName ? indexedName(configuredName, runnerIndex) : instanceServiceName;
				return { ...configured, serviceName, railwayServiceName: serviceName };
			};
			services.push({
			id: instanceId,
			label: placement === 'runner-capacity' ? `Runner Capacity ${String(runnerIndex).padStart(2, '0')}` : serviceKey === 'api' ? 'API Runtime' : serviceKey,
			serviceType,
			placement,
			projectGroupId: defaultProjectGroup,
			config: {
				rootDir: service.railway?.rootDir ?? service.rootDir ?? '.',
				imageRef: sourcePolicy.imageRef,
				imageRefEnv: sourcePolicy.sourceMode === 'image' ? imageRefEnv : null,
				sourceMode: sourcePolicy.sourceMode,
				sourceRepo: sourcePolicy.sourceRepo,
				sourceBranch: sourcePolicy.sourceBranch,
				sourceCommit: sourcePolicy.sourceCommit,
				sourceRootDirectory: sourcePolicy.sourceRootDirectory,
				dockerfilePath: sourcePolicy.sourceMode === 'git'
					? service.railway?.dockerfilePath ?? apiRailwayDefaultDockerfilePath({ key: serviceKey, serviceName: service.railway?.serviceName ?? null })
					: null,
				buildCommand: sourcePolicy.imageRef || (sourcePolicy.sourceMode === 'git' && service.railway?.dockerfilePath)
					? null
					: service.railway?.buildCommand ?? null,
				startCommand: sourcePolicy.imageRef ? null : service.railway?.startCommand ?? null,
				healthcheckPath: service.railway?.healthcheckPath ?? null,
				runtimeMode: service.railway?.runtimeMode ?? null,
				volumeMountPath,
				volumeName: volumeMountPath && instanceServiceName ? `${instanceServiceName}-volume` : null,
				runnerPool: runnerPool ? { ...runnerPool, bootstrapCount: instanceCount, maxRunners } : null,
				runnerIndex: runnerPool ? runnerIndex : null,
				poolKey: runnerPool ? serviceKey : null,
				runnerId: runnerPool ? instanceServiceName : null,
				resourceType: service.railway?.resourceType ?? null,
				serviceName: instanceServiceName,
				serviceTargets: service.railway?.serviceTargets ?? null,
			},
			secretRefs: serviceKey === 'treeseedDatabase' ? ['TREESEED_DATABASE_URL'] : [],
			variableRefs: serviceKey === 'operationsRunner'
				? ['TREESEED_PLATFORM_RUNNER_ID', 'TREESEED_PLATFORM_RUNNER_DATA_DIR', 'TREESEED_PLATFORM_RUNNER_ENVIRONMENT']
				: [],
			metadata: String(serviceKey).startsWith('capacityProvider')
				? { capacityProvider: true, deployByDefault: false }
				: runnerPool ? { poolKey: serviceKey, runnerIndex } : {},
			environments: {
				local: {
					hostId: serviceType === 'relational-database' || serviceType === 'runner-pool' || service.railway?.volumeMountPath ? 'local-docker' : 'local-process',
					projectGroupId: undefined,
					config: environmentBinding('local'),
				},
				staging: {
					hostId: service.provider ?? 'railway',
					projectGroupId: defaultProjectGroup,
					config: environmentBinding('staging'),
				},
				prod: {
					hostId: service.provider ?? 'railway',
					projectGroupId: defaultProjectGroup,
					config: environmentBinding('prod'),
				},
			},
			});
		}
	}

	if (config.cloudflare?.r2) {
		services.push({
			id: 'content-storage',
			label: 'Content Storage',
			serviceType: 'object-store',
			placement: 'content-storage',
			config: {
				bucketName: config.cloudflare.r2.bucketName ?? null,
				manifestKeyTemplate: config.cloudflare.r2.manifestKeyTemplate ?? null,
				previewRootTemplate: config.cloudflare.r2.previewRootTemplate ?? null,
			},
			environments: {
				local: { hostId: 'local-docker' },
				staging: { hostId: 'cloudflare' },
				prod: { hostId: 'cloudflare' },
			},
		});
	}

	if (config.smtp?.enabled === true) {
		services.push({
			id: 'email',
			label: 'Email',
			serviceType: 'email-relay',
			placement: 'email',
			secretRefs: ['SMTP_PASSWORD'],
			environments: {
				local: { hostId: 'smtp' },
				staging: { hostId: 'smtp' },
				prod: { hostId: 'smtp' },
			},
		});
	}

	if (config.hosting?.kind === 'treeseed_control_plane') {
		const treeDxNodePool = publicTreeDxNodePool(config);
		const treeDxSourcePolicy = publicTreeDxSourcePolicy(input, config, launchEnv);
		const treeDxNodeUnits = Array.from({ length: treeDxNodePool.bootstrapCount }, (_, offset) => {
			const nodeIndex = offset + 1;
			const logicalServiceName = indexedName('public-treedx-node', nodeIndex);
			const serviceName = railwayTreeDxServiceName(nodeIndex, input.environment);
			assertRailwayResourceNames(serviceName, `${serviceName}-volume`);
			return {
				id: logicalServiceName,
				label: `Public TreeDX node ${String(nodeIndex).padStart(2, '0')}`,
				serviceType: 'treedx-node',
				placement: 'knowledge-library' as const,
				projectGroupId: 'public-treedx-federation',
				config: {
					...(treeDxSourcePolicy.image ? { image: treeDxSourcePolicy.image } : {}),
					...(treeDxSourcePolicy.imageRef ? { imageRef: treeDxSourcePolicy.imageRef } : {}),
					...(treeDxSourcePolicy.imageTagRef ? { imageTagRef: treeDxSourcePolicy.imageTagRef } : {}),
					sourceMode: treeDxSourcePolicy.sourceMode,
					...(treeDxSourcePolicy.sourceRepo ? { sourceRepo: treeDxSourcePolicy.sourceRepo } : {}),
					...(treeDxSourcePolicy.sourceBranch ? { sourceBranch: treeDxSourcePolicy.sourceBranch } : {}),
					...(treeDxSourcePolicy.sourceCommit ? { sourceCommit: treeDxSourcePolicy.sourceCommit } : {}),
					...(treeDxSourcePolicy.sourceRootDirectory ? { sourceRootDirectory: treeDxSourcePolicy.sourceRootDirectory } : {}),
					serviceName,
					volumeName: `${serviceName}-volume`,
					volumeMountPath: '/data',
					runtimeMode: 'replicated',
					environmentVariables: {
						PORT: '4000',
						TREEDX_DATA_DIR: '/data',
						TREEDX_AUTH_MODE: 'connected',
						TREEDX_AUTH_VERIFIER: 'hs256_dev',
						TREEDX_ALLOW_DEV_VERIFIER_IN_PROD: 'true',
						TREEDX_EXEC_BACKEND: 'container_sandbox',
						TREEDX_FEDERATION_MODE: 'connected_library',
						TREEDX_JWT_AUDIENCE: 'treedx-public-federation',
						TREEDX_JWT_ISSUER: 'https://api.treeseed.local/treedx',
						TREEDX_BOOTSTRAP_TRUST_ACTOR_ID: 'treeseed-api',
						TREEDX_BOOTSTRAP_TRUST_TENANT_ID: 'treeseed-control-plane',
						TREEDX_BOOTSTRAP_TRUST_REPO_IDS: '*',
						TREEDX_BOOTSTRAP_TRUST_REFS: '*',
						TREEDX_BOOTSTRAP_TRUST_PATHS: '**',
						TREEDX_SCOPE: 'public_federation',
					},
				},
				variableRefs: [
					'PORT',
					'TREEDX_DATA_DIR',
					'TREEDX_AUTH_MODE',
					'TREEDX_AUTH_VERIFIER',
					'TREEDX_ALLOW_DEV_VERIFIER_IN_PROD',
					'TREEDX_EXEC_BACKEND',
					'TREEDX_FEDERATION_MODE',
					'TREEDX_JWT_AUDIENCE',
					'TREEDX_JWT_ISSUER',
					'TREEDX_BOOTSTRAP_TRUST_ACTOR_ID',
					'TREEDX_BOOTSTRAP_TRUST_TENANT_ID',
					'TREEDX_BOOTSTRAP_TRUST_REPO_IDS',
					'TREEDX_BOOTSTRAP_TRUST_REFS',
					'TREEDX_BOOTSTRAP_TRUST_PATHS',
					'TREEDX_SCOPE',
				],
				secretRefs: ['TREEDX_SECRET_KEY_BASE', 'TREEDX_ADMIN_TOKEN', 'TREEDX_JWT_HS256_SECRET'],
				environments: {
					local: { hostId: 'local-docker', projectGroupId: 'public-treedx-federation' },
					staging: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
					prod: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
				},
				metadata: {
					publicFederation: true,
					defaultNode: nodeIndex === 1,
					nodeIndex,
					maxNodes: treeDxNodePool.maxNodes,
					retainVolumeOnScaleDown: true,
				},
			};
		});
		services.push(
			{
				id: 'public-treedx-federation',
				label: 'Public TreeDX federation',
				serviceType: 'treedx-federation',
				placement: 'knowledge-library',
				projectGroupId: 'public-treedx-federation',
				dependencies: treeDxNodeUnits.map((unit) => unit.id),
				config: {
					projectName: marketProjectGroup(environment, config).environments.staging?.projectName ?? config.slug ?? 'treeseed-api',
					isolation: 'same API Railway project, separate service, volume, and domain',
					federationMode: 'connected_library',
					nodePool: treeDxNodePool,
				},
				environments: {
					local: { hostId: 'local-docker', projectGroupId: 'public-treedx-federation' },
					staging: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
					prod: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
				},
				metadata: { publicFederation: true, nodeCount: treeDxNodePool.bootstrapCount, maxNodes: treeDxNodePool.maxNodes },
			},
			...treeDxNodeUnits,
		);
	}

	return {
		id: `${config.slug}-compiled`,
		label: `${config.name} hosting profile`,
		services,
		projectGroups,
		metadata: {
			source: 'treeseed.site.yaml',
			environment,
		},
	};
}
