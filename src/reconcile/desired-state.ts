import { loadTreeseedPlatformConfig } from '../platform/config.ts';
import {
	loadDeployState,
	resolveConfiguredSurfaceDomain,
	resolveTreeseedResourceIdentity,
} from '../operations/services/deploy.ts';
import { configuredRailwayServices } from '../operations/services/railway-deploy.ts';
import { normalizeRailwayEnvironmentName } from '../operations/services/railway-api.ts';
import type { TreeseedDesiredUnit, TreeseedReconcileTarget } from './contracts.ts';
import { createTreeseedReconcileUnitId } from './units.ts';

function railwayConcreteUnitTypeForServiceKey(serviceKey: string) {
	switch (serviceKey) {
		case 'api':
			return 'railway-service:api' as const;
		case 'operationsRunner':
			return 'railway-service:operations-runner' as const;
		case 'workdayManager':
			return 'railway-service:workday-manager' as const;
		case 'workerRunner':
			return 'railway-service:worker-runner' as const;
		default:
			return 'railway-service:api' as const;
	}
}

function isPublicTreeDxNodeServiceKey(serviceKey: string) {
	return serviceKey.startsWith('public-treedx-node-');
}

export function deriveTreeseedDesiredUnits({
	tenantRoot,
	target,
}: {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
}) {
	const deployConfig = loadTreeseedPlatformConfig({ tenantRoot, environment: target.kind === 'persistent' ? target.scope : 'staging', env: process.env }).deployConfig;
	const legacyState = loadDeployState(tenantRoot, deployConfig, { target });
	const identity = legacyState.identity ?? resolveTreeseedResourceIdentity(deployConfig, target);
	const units: TreeseedDesiredUnit[] = [];
	const add = (unit: TreeseedDesiredUnit) => {
		units.push(unit);
		return unit.unitId;
	};

	const databaseId = add({
		unitId: createTreeseedReconcileUnitId('database', legacyState.d1Databases.SITE_DATA_DB.databaseName),
		unitType: 'database',
		provider: 'cloudflare',
		identity,
		target,
		logicalName: legacyState.d1Databases.SITE_DATA_DB.databaseName,
		dependencies: [],
		spec: {
			databaseName: legacyState.d1Databases.SITE_DATA_DB.databaseName,
			binding: 'SITE_DATA_DB',
		},
		secrets: {},
		metadata: { bootstrapSystem: 'data' },
	});
	const formGuardKvId = add({
		unitId: createTreeseedReconcileUnitId('kv-form-guard', legacyState.kvNamespaces.FORM_GUARD_KV.name),
		unitType: 'kv-form-guard',
		provider: 'cloudflare',
		identity,
		target,
		logicalName: legacyState.kvNamespaces.FORM_GUARD_KV.name,
		dependencies: [],
		spec: { binding: 'FORM_GUARD_KV', name: legacyState.kvNamespaces.FORM_GUARD_KV.name },
		secrets: {},
		metadata: { bootstrapSystem: 'web' },
	});
	const turnstileWidgetId = legacyState.turnstileWidgets?.formGuard?.name && deployConfig.turnstile?.enabled === true
		? add({
			unitId: createTreeseedReconcileUnitId('turnstile-widget', legacyState.turnstileWidgets.formGuard.name),
			unitType: 'turnstile-widget',
			provider: 'cloudflare',
			identity,
			target,
			logicalName: legacyState.turnstileWidgets.formGuard.name,
			dependencies: [],
			spec: {
				name: legacyState.turnstileWidgets.formGuard.name,
				domains: legacyState.turnstileWidgets.formGuard.domains ?? [],
				mode: 'managed',
			},
			secrets: {},
			metadata: { bootstrapSystem: 'web' },
		})
		: null;
	const contentStoreId = add({
		unitId: createTreeseedReconcileUnitId('content-store', legacyState.content.bucketName ?? deployConfig.slug),
		unitType: 'content-store',
		provider: 'cloudflare',
		identity,
		target,
		logicalName: legacyState.content.bucketName ?? deployConfig.slug,
		dependencies: [],
		spec: {
			bucketName: legacyState.content.bucketName,
			binding: legacyState.content.r2Binding,
			publicBaseUrl: legacyState.content.publicBaseUrl,
			manifestKeyTemplate: legacyState.content.manifestKeyTemplate,
			previewRootTemplate: legacyState.content.previewRootTemplate,
		},
		secrets: {},
		metadata: { shared: true, bootstrapSystem: 'data' },
	});
	const pagesProjectId = add({
		unitId: createTreeseedReconcileUnitId('pages-project', legacyState.pages.projectName),
		unitType: 'pages-project',
		provider: 'cloudflare',
		identity,
		target,
		logicalName: legacyState.pages.projectName,
		dependencies: [],
		spec: {
			projectName: legacyState.pages.projectName,
			productionBranch: legacyState.pages.productionBranch,
			stagingBranch: legacyState.pages.stagingBranch,
			buildOutputDir: legacyState.pages.buildOutputDir,
		},
		secrets: {},
		metadata: { bootstrapSystem: 'web' },
	});
	const edgeWorkerId = add({
		unitId: createTreeseedReconcileUnitId('edge-worker', legacyState.workerName),
		unitType: 'edge-worker',
		provider: 'cloudflare',
		identity,
		target,
		logicalName: legacyState.workerName,
		dependencies: [databaseId, formGuardKvId, ...(turnstileWidgetId ? [turnstileWidgetId] : []), contentStoreId, pagesProjectId],
		spec: {
			workerName: legacyState.workerName,
		},
		secrets: {},
		metadata: { bootstrapSystem: 'web' },
	});
	if (deployConfig.surfaces?.web?.enabled !== false) {
		const scope = target.kind === 'persistent' ? target.scope : 'staging';
		const webDomain = target.kind === 'persistent'
			? resolveConfiguredSurfaceDomain(deployConfig, target, 'web')
			: null;
		const webDomainUnitId = webDomain
			? add({
				unitId: createTreeseedReconcileUnitId('custom-domain:web', webDomain),
				unitType: 'custom-domain:web',
				provider: 'cloudflare',
				identity,
				target,
				logicalName: webDomain,
				dependencies: [pagesProjectId],
				spec: {
					domain: webDomain,
					projectName: legacyState.pages.projectName,
				},
				secrets: {},
				metadata: { surface: 'web', bootstrapSystem: 'web' },
			})
			: null;
		const webDnsUnitId = webDomain
			? add({
				unitId: createTreeseedReconcileUnitId('dns-record', `web:${webDomain}`),
				unitType: 'dns-record',
				provider: deployConfig.providers?.dns ?? 'cloudflare-dns',
				identity,
				target,
				logicalName: `web:${webDomain}`,
				dependencies: webDomainUnitId ? [webDomainUnitId] : [],
				spec: {
					domain: webDomain,
					zoneHost: webDomain,
					recordName: webDomain,
					recordType: 'CNAME',
					recordContent: scope === 'prod'
						? `${legacyState.pages.projectName}.pages.dev`
						: `${legacyState.pages.stagingBranch ?? 'staging'}.${legacyState.pages.projectName}.pages.dev`,
					proxied: true,
					targetKind: 'pages-project',
				},
				secrets: {},
				metadata: { surface: 'web', bootstrapSystem: 'web' },
			})
			: null;
		add({
			unitId: createTreeseedReconcileUnitId('web-ui', 'web-ui'),
			unitType: 'web-ui',
			provider: 'treeseed',
			identity,
			target,
			logicalName: 'web-ui',
			dependencies: [
				edgeWorkerId,
				pagesProjectId,
				contentStoreId,
				...(webDomainUnitId ? [webDomainUnitId] : []),
				...(webDnsUnitId ? [webDnsUnitId] : []),
			],
			spec: {
				publicBaseUrl: deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl,
				localBaseUrl: deployConfig.surfaces?.web?.localBaseUrl ?? null,
			},
			secrets: {},
			metadata: { bootstrapSystem: 'web' },
		});
	}

	const scope = target.kind === 'persistent' ? target.scope : 'staging';
	for (const configuredService of configuredRailwayServices(tenantRoot, scope)) {
		const serviceKey = configuredService.key;
		const service = configuredService.serviceConfig ?? deployConfig.services?.[serviceKey];
		const serviceState = legacyState.services?.[serviceKey];
		if (isPublicTreeDxNodeServiceKey(serviceKey)) {
			// Public TreeDX nodes are generated from the hosting profile rather than deployConfig.services.
		} else if (!service || service.enabled === false || service.provider !== 'railway') {
			continue;
		}
		const concreteType = railwayConcreteUnitTypeForServiceKey(serviceKey);
		const serviceBootstrapSystem = serviceKey === 'api' || isPublicTreeDxNodeServiceKey(serviceKey) ? 'api' : 'agents';
		const desiredServiceName = configuredService.serviceName ?? serviceState?.serviceName ?? serviceKey;
		const desiredProjectName = configuredService.projectName ?? serviceState?.projectName;
		const persistedServiceMatchesDesired = (!serviceState?.serviceName || serviceState.serviceName === desiredServiceName)
			&& (!serviceState?.projectName || serviceState.projectName === desiredProjectName);
		const concreteId = add({
			unitId: createTreeseedReconcileUnitId(concreteType, desiredServiceName),
			unitType: concreteType,
			provider: 'railway',
			identity,
			target,
			logicalName: desiredServiceName,
			dependencies: [],
			spec: {
				projectId: persistedServiceMatchesDesired ? serviceState?.projectId ?? configuredService.projectId : configuredService.projectId,
				projectName: desiredProjectName,
				serviceId: persistedServiceMatchesDesired ? serviceState?.serviceId ?? configuredService.serviceId : configuredService.serviceId,
				serviceName: desiredServiceName,
				rootDir: configuredService.rootDir ?? serviceState?.rootDir,
				environment: normalizeRailwayEnvironmentName(configuredService.railwayEnvironment ?? serviceState?.environment),
				buildCommand: configuredService.buildCommand,
				startCommand: configuredService.startCommand,
				healthcheckPath: configuredService.healthcheckPath,
				healthcheckTimeoutSeconds: configuredService.healthcheckTimeoutSeconds,
				healthcheckIntervalSeconds: configuredService.healthcheckIntervalSeconds,
				restartPolicy: configuredService.restartPolicy,
				runtimeMode: configuredService.runtimeMode,
				schedule: serviceState?.schedule ?? configuredService.schedule,
				publicBaseUrl: serviceState?.publicBaseUrl ?? configuredService.publicBaseUrl,
			},
			secrets: {},
			metadata: {
				serviceKey,
				scheduleManaged: Array.isArray(configuredService.schedule) && configuredService.schedule.length > 0,
				scheduleBootstrap: false,
				scheduleDeployScopes: ['staging', 'prod'],
				bootstrapSystem: serviceBootstrapSystem,
			},
		});
		const apiDomain = serviceKey === 'api' && target.kind === 'persistent'
			? resolveConfiguredSurfaceDomain(deployConfig, target, 'api')
			: null;
		const apiCustomDomainId = apiDomain
			? add({
				unitId: createTreeseedReconcileUnitId('custom-domain:api', apiDomain),
				unitType: 'custom-domain:api',
				provider: 'railway',
				identity,
				target,
				logicalName: apiDomain,
				dependencies: [concreteId],
				spec: {
					domain: apiDomain,
					serviceName: desiredServiceName,
					projectName: desiredProjectName,
					environment: normalizeRailwayEnvironmentName(configuredService.railwayEnvironment ?? serviceState?.environment),
				},
				secrets: {},
				metadata: { surface: 'api', serviceKey, bootstrapSystem: 'api' },
			})
			: null;
		const apiDnsUnitId = apiDomain
			? add({
				unitId: createTreeseedReconcileUnitId('dns-record', `api:${apiDomain}`),
				unitType: 'dns-record',
				provider: deployConfig.providers?.dns ?? 'cloudflare-dns',
				identity,
				target,
				logicalName: `api:${apiDomain}`,
				dependencies: apiCustomDomainId ? [apiCustomDomainId] : [concreteId],
				spec: {
					domain: apiDomain,
					zoneHost: apiDomain,
					targetKind: 'railway-service',
					serviceKey,
				},
				secrets: {},
				metadata: { surface: 'api', serviceKey, bootstrapSystem: 'api' },
			})
			: null;
		const runtimeUnitType = (() => {
			switch (serviceKey) {
				case 'api': return 'api-runtime';
				case 'operationsRunner': return 'operations-runner-runtime';
				case 'workdayManager': return 'workday-manager-runtime';
				case 'workerRunner': return 'worker-runner-runtime';
				default: return isPublicTreeDxNodeServiceKey(serviceKey) ? 'api-runtime' : 'api-runtime';
			}
		})();
		add({
			unitId: createTreeseedReconcileUnitId(runtimeUnitType, serviceKey),
			unitType: runtimeUnitType,
			provider: 'treeseed',
			identity,
			target,
			logicalName: serviceKey,
			dependencies: [
				concreteId,
				...(apiCustomDomainId ? [apiCustomDomainId] : []),
				...(apiDnsUnitId ? [apiDnsUnitId] : []),
			],
			spec: {
				serviceKey,
				publicBaseUrl: serviceState?.publicBaseUrl ?? null,
			},
			secrets: {},
			metadata: { bootstrapSystem: serviceBootstrapSystem },
		});
	}

	return { deployConfig, legacyState, units };
}
