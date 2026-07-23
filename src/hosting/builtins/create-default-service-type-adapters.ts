import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { resolveTreeseedLaunchEnvironment } from '../../operations/services/config-runtime.ts';
import { cloudflareApiRequest, resolveCloudflareZoneIdForHost, resolveConfiguredCloudflareAccountId, runWrangler } from '../../operations/services/deploy.ts';
import type {
	TreeseedApplicationHostingProfile,
	TreeseedHostAdapter,
	TreeseedHostAdapterOperationInput,
	TreeseedHostAdapterOperationResult,
	TreeseedHostCapability,
	TreeseedHostingEnvironment,
	TreeseedHostingStatus,
	TreeseedHostingUnit,
	TreeseedHostingUnitPlan,
	TreeseedHostingVerification,
	TreeseedServicePlacement,
	TreeseedServiceTypeAdapter,
} from '../contracts.ts';
import { serviceType } from './create-cloudflare-host-adapter.ts';

export function createDefaultServiceTypeAdapters(): Record<string, TreeseedServiceTypeAdapter> {
	return {
		'web-site': serviceType('web-site', 'Web site', 'web', ['web-site', 'deployment', 'health'], {
			local: 'local-process',
			staging: 'cloudflare',
			prod: 'cloudflare',
		}),
		'container-api': serviceType('container-api', 'Container API', 'api', ['container', 'variable', 'deployment', 'health'], {
			local: 'local-process',
			staging: 'railway',
			prod: 'railway',
		}),
		'stateful-container': serviceType('stateful-container', 'Stateful container', 'operations', ['container', 'volume', 'variable', 'deployment', 'health'], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}),
		'runner-pool': serviceType('runner-pool', 'Runner pool', 'runner-capacity', ['container', 'volume', 'variable', 'deployment', 'health'], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}),
		'scheduled-job': serviceType('scheduled-job', 'Scheduled job', 'operations', ['scheduled-job', 'variable', 'deployment', 'health'], {
			local: 'local-process',
			staging: 'railway',
			prod: 'railway',
		}),
		'relational-database': serviceType('relational-database', 'Relational database', 'database', ['database', 'secret', 'health'], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}),
		'object-store': serviceType('object-store', 'Object store', 'content-storage', ['object-store', 'health'], {
			local: 'local-docker',
			staging: 'cloudflare',
			prod: 'cloudflare',
		}),
		'source-repository': serviceType('source-repository', 'Source repository', 'repository', ['source-repository', 'health'], {
			local: 'local-process',
			staging: 'github',
			prod: 'github',
		}),
		'email-relay': serviceType('email-relay', 'Email relay', 'email', ['email-relay', 'secret', 'health'], {
			local: 'smtp',
			staging: 'smtp',
			prod: 'smtp',
		}),
		'knowledge-library': serviceType('knowledge-library', 'Knowledge library', 'knowledge-library', [], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}, ['treedx-federation']),
		'treedx-node': serviceType('treedx-node', 'TreeDX node', 'knowledge-library', ['container', 'volume', 'variable', 'deployment', 'health'], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}, ['stateful-container']),
		'treedx-federation': serviceType('treedx-federation', 'TreeDX federation', 'knowledge-library', [], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}, ['treedx-node']),
		'treeseed-control-plane': serviceType('treeseed-control-plane', 'Treeseed control plane', 'operations', [], {
			local: 'local-process',
			staging: 'railway',
			prod: 'railway',
		}, ['container-api', 'runner-pool', 'relational-database']),
		'capacity-provider': serviceType('capacity-provider', 'Capacity provider', 'runner-capacity', [], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}, ['runner-pool']),
	};
}

export function createDefaultHostingProfiles(): TreeseedApplicationHostingProfile[] {
	return [
		{
			id: 'treeseed-managed-public-team',
			label: 'TreeSeed managed public team',
			description: 'Public teams use the shared public TreeDX federation and managed web/content defaults.',
			services: [],
			metadata: { publicRead: true, managed: true },
		},
		{
			id: 'treeseed-managed-private-team',
			label: 'TreeSeed managed private team',
			description: 'Private teams receive dedicated managed infrastructure for privacy-bearing data.',
			services: [],
			metadata: { publicRead: false, managed: true },
		},
		{
			id: 'customer-self-hosted',
			label: 'Customer self-hosted',
			description: 'Customer-owned hosts satisfy the same service capabilities.',
			services: [],
			metadata: { managed: false },
		},
		{
			id: 'local-development',
			label: 'Local development',
			description: 'Hot-reload local processes for code services and local Docker for stateful services.',
			services: [],
			metadata: { local: true, hotReload: true },
		},
		{
			id: 'production-like-local',
			label: 'Production-like local',
			description: 'Local containers model provider-backed runtime behavior without mutating hosted resources.',
			services: [],
			metadata: { local: true, productionLike: true },
		},
	];
}

export function sanitizedUnitConfig(unit: TreeseedHostingUnit) {
	return {
		id: unit.id,
		label: unit.label,
		serviceType: unit.serviceType.id,
		placement: unit.placement,
		hostId: unit.host.id,
		environment: unit.environment,
		projectGroupId: unit.projectGroup?.id ?? null,
		requiredCapabilities: unit.requiredCapabilities,
		secretRefs: unit.secretRefs,
		variableRefs: unit.variableRefs,
		application: unit.application
			? {
				id: unit.application.id,
				relativeRoot: unit.application.relativeRoot,
				roles: unit.application.roles,
			}
			: null,
		config: redactSensitiveConfig(unit.config),
		metadata: redactSensitiveConfig(unit.metadata),
	};
}

export function redactSensitiveConfig(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((entry) => redactSensitiveConfig(entry));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
		if (/(secret|token|password|privateKey|apiKey|credential)/iu.test(key)) {
			return [key, '[redacted]'];
		}
		return [key, redactSensitiveConfig(entry)];
	}));
}

export function summarizePlacementStatus(statuses: TreeseedHostingStatus[]): TreeseedHostingStatus {
	if (statuses.includes('blocked')) return 'blocked';
	if (statuses.includes('degraded')) return 'degraded';
	if (statuses.includes('pending')) return 'pending';
	if (statuses.includes('ready')) return 'ready';
	return 'unknown';
}
