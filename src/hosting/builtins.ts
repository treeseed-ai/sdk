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
} from './contracts.ts';

const ALL_ENVIRONMENTS: TreeseedHostingEnvironment[] = ['local', 'staging', 'prod'];
const PROVIDER_ENVIRONMENTS: TreeseedHostingEnvironment[] = ['staging', 'prod'];

function capabilities(ids: TreeseedHostCapability[], environments: TreeseedHostingEnvironment[] = ALL_ENVIRONMENTS) {
	return ids.map((id) => ({ id, environments }));
}

function syntheticStatus(input: TreeseedHostAdapterOperationInput): TreeseedHostAdapterOperationResult {
	return {
		status: 'pending',
		locators: {
			hostId: input.unit.host.id,
			projectGroupId: input.unit.projectGroup?.id ?? null,
		},
		state: {
			unitId: input.unit.id,
			serviceType: input.unit.serviceType.id,
			placement: input.unit.placement,
			dryRun: input.dryRun === true,
		},
		warnings: [],
	};
}

function defaultPlan(input: TreeseedHostAdapterOperationInput & { observed: TreeseedHostAdapterOperationResult }): TreeseedHostingUnitPlan {
	return {
		unitId: input.unit.id,
		action: input.observed.status === 'ready' ? 'noop' : 'create',
		reasons: input.observed.status === 'ready' ? ['unit already ready'] : ['unit is not yet recorded as ready by the hosting graph'],
		before: input.observed.state,
		after: sanitizedUnitConfig(input.unit),
		warnings: [],
	};
}

function defaultVerify(input: TreeseedHostAdapterOperationInput & { observed: TreeseedHostAdapterOperationResult }): TreeseedHostingVerification {
	const hostCapabilities = new Set(input.unit.host.capabilities
		.filter((capability) => capability.environments.includes(input.environment))
		.map((capability) => capability.id));
	const missing = input.unit.requiredCapabilities.filter((capability) => !hostCapabilities.has(capability));
	return {
		unitId: input.unit.id,
		status: missing.length === 0 ? input.observed.status : 'blocked',
		verified: missing.length === 0,
		checks: [
			{
				key: 'host-capabilities',
				label: 'Host supports required capabilities',
				ok: missing.length === 0,
				expected: input.unit.requiredCapabilities,
				observed: [...hostCapabilities],
				issues: missing.map((capability) => `Missing host capability: ${capability}`),
			},
			{
				key: 'secrets-redacted',
				label: 'Secrets are represented by references only',
				ok: !JSON.stringify(input.unit.config).match(/(token|secret|password|key)\s*[:=]\s*[^",}]+/iu),
				expected: 'secretRefs',
				observed: input.unit.secretRefs,
				issues: [],
			},
		],
		warnings: [],
	};
}

function createSyntheticHostAdapter(
	id: string,
	label: string,
	capabilityIds: TreeseedHostCapability[],
	environments: TreeseedHostingEnvironment[] = ALL_ENVIRONMENTS,
): TreeseedHostAdapter {
	return {
		id,
		label,
		capabilities: capabilities(capabilityIds, environments),
		observe: syntheticStatus,
		plan: defaultPlan,
		apply(input) {
			return {
				...syntheticStatus(input),
				status: input.dryRun ? 'pending' : 'ready',
				state: {
					...syntheticStatus(input).state,
					applied: input.dryRun !== true,
				},
			};
		},
		verify: defaultVerify,
		status: syntheticStatus,
	};
}

export function createDefaultHostAdapters(): Record<string, TreeseedHostAdapter> {
	return {
		railway: createSyntheticHostAdapter('railway', 'Railway', [
			'project',
			'environment',
			'container',
			'volume',
			'database',
			'domain',
			'secret',
			'variable',
			'deployment',
			'scheduled-job',
			'health',
			'logs',
		], PROVIDER_ENVIRONMENTS),
		cloudflare: createSyntheticHostAdapter('cloudflare', 'Cloudflare', [
			'web-site',
			'object-store',
			'database',
			'dns',
			'domain',
			'secret',
			'variable',
			'deployment',
			'health',
		], PROVIDER_ENVIRONMENTS),
		github: createSyntheticHostAdapter('github', 'GitHub', [
			'source-repository',
			'workflow',
			'secret',
			'variable',
			'health',
		], PROVIDER_ENVIRONMENTS),
		smtp: createSyntheticHostAdapter('smtp', 'SMTP', [
			'email-relay',
			'secret',
			'health',
		], ALL_ENVIRONMENTS),
		'local-process': createSyntheticHostAdapter('local-process', 'Local process', [
			'process',
			'web-site',
			'container',
			'variable',
			'deployment',
			'health',
			'logs',
			'port',
			'hot-reload',
		], ['local']),
		'local-docker': createSyntheticHostAdapter('local-docker', 'Local Docker', [
			'container',
			'volume',
			'database',
			'object-store',
			'secret',
			'variable',
			'deployment',
			'health',
			'logs',
		], ['local']),
	};
}

function serviceType(
	id: string,
	label: string,
	placement: TreeseedServicePlacement,
	requiredCapabilities: TreeseedHostCapability[],
	defaultHostByEnvironment: Partial<Record<TreeseedHostingEnvironment, string>>,
	composes: string[] = [],
): TreeseedServiceTypeAdapter {
	return {
		id,
		label,
		placement,
		requiredCapabilities,
		defaultHostByEnvironment,
		composes,
		describe(unit) {
			return `${label} on ${unit.host.label}`;
		},
	};
}

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
		}, ['treedb-federation']),
		'treedb-node': serviceType('treedb-node', 'TreeDB node', 'knowledge-library', ['container', 'volume', 'variable', 'deployment', 'health'], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}, ['stateful-container']),
		'treedb-federation': serviceType('treedb-federation', 'TreeDB federation', 'knowledge-library', [], {
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		}, ['treedb-node']),
		'market-control-plane': serviceType('market-control-plane', 'Market control plane', 'operations', [], {
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
			description: 'Public teams use the shared public TreeDB federation and managed web/content defaults.',
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
