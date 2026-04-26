import type { TreeseedDeployConfig } from '../platform/contracts.ts';
import type { TreeseedDesiredUnit } from './contracts.ts';

export const TREESEED_BOOTSTRAP_SYSTEMS = ['github', 'data', 'web', 'api', 'agents'] as const;
export type TreeseedBootstrapSystem = typeof TREESEED_BOOTSTRAP_SYSTEMS[number] | 'all';
export type TreeseedRunnableBootstrapSystem = Exclude<TreeseedBootstrapSystem, 'all'>;

const BOOTSTRAP_SYSTEM_SET = new Set<string>(TREESEED_BOOTSTRAP_SYSTEMS);
const SYSTEM_DEPENDENCIES: Record<TreeseedRunnableBootstrapSystem, TreeseedRunnableBootstrapSystem[]> = {
	github: [],
	data: [],
	web: ['data'],
	api: ['data'],
	agents: ['data'],
};

export type TreeseedBootstrapSystemStatus = {
	system: TreeseedRunnableBootstrapSystem;
	status: 'selected' | 'included_dependency' | 'config_disabled' | 'unavailable' | 'skipped';
	reason: string;
	missing: string[];
};

export type TreeseedBootstrapSelection = {
	requested: TreeseedBootstrapSystem[];
	explicit: boolean;
	skipUnavailable: boolean;
	selected: TreeseedRunnableBootstrapSystem[];
	expanded: TreeseedRunnableBootstrapSystem[];
	runnable: TreeseedRunnableBootstrapSystem[];
	configDisabled: TreeseedBootstrapSystemStatus[];
	unavailable: TreeseedBootstrapSystemStatus[];
	skipped: TreeseedBootstrapSystemStatus[];
	statuses: TreeseedBootstrapSystemStatus[];
};

function uniqueSystems(values: TreeseedBootstrapSystem[]) {
	return [...new Set(values)] as TreeseedBootstrapSystem[];
}

export function parseTreeseedBootstrapSystems(value: unknown): TreeseedBootstrapSystem[] {
	const raw = Array.isArray(value)
		? value
		: typeof value === 'string'
			? [value]
			: ['all'];
	const systems = raw
		.flatMap((entry) => String(entry).split(','))
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (systems.length === 0 || systems.includes('all')) {
		return ['all'];
	}
	const invalid = systems.filter((system) => !BOOTSTRAP_SYSTEM_SET.has(system));
	if (invalid.length > 0) {
		throw new Error(`Unknown Treeseed bootstrap system "${invalid[0]}". Expected one of all, ${TREESEED_BOOTSTRAP_SYSTEMS.join(', ')}.`);
	}
	return uniqueSystems(systems as TreeseedBootstrapSystem[]);
}

function expandBootstrapSystems(systems: TreeseedRunnableBootstrapSystem[]) {
	const expanded = new Set<TreeseedRunnableBootstrapSystem>();
	const visit = (system: TreeseedRunnableBootstrapSystem) => {
		for (const dependency of SYSTEM_DEPENDENCIES[system]) {
			visit(dependency);
		}
		expanded.add(system);
	};
	for (const system of systems) {
		visit(system);
	}
	return [...expanded];
}

function serviceEnabled(config: TreeseedDeployConfig, serviceKey: string) {
	const service = config.services?.[serviceKey];
	return Boolean(service && service.enabled !== false && (service.provider ?? 'railway') === 'railway');
}

function apiSystemDisabled(config: TreeseedDeployConfig) {
	if (config.runtime?.mode === 'none') {
		return 'runtime.mode is none.';
	}
	if (config.surfaces?.api?.enabled === false) {
		return 'surfaces.api.enabled is false.';
	}
	if (!serviceEnabled(config, 'api')) {
		return 'services.api is not enabled for Railway.';
	}
	return null;
}

function agentsSystemDisabled(config: TreeseedDeployConfig) {
	if (config.runtime?.mode === 'none') {
		return 'runtime.mode is none.';
	}
	const enabled = ['manager', 'worker', 'workdayStart', 'workdayReport'].some((serviceKey) => serviceEnabled(config, serviceKey));
	return enabled ? null : 'No agent Railway services are enabled.';
}

function hasValue(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string) {
	return typeof env[key] === 'string' && String(env[key]).trim().length > 0;
}

function missingForSystem(system: TreeseedRunnableBootstrapSystem, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	switch (system) {
		case 'github':
			return hasValue(env, 'GH_TOKEN') || hasValue(env, 'GITHUB_TOKEN') ? [] : ['GH_TOKEN'];
		case 'data':
		case 'web':
			return hasValue(env, 'CLOUDFLARE_API_TOKEN') ? [] : ['CLOUDFLARE_API_TOKEN'];
		case 'api':
		case 'agents':
			return hasValue(env, 'RAILWAY_API_TOKEN') ? [] : ['RAILWAY_API_TOKEN'];
		default:
			return [];
	}
}

export function resolveTreeseedBootstrapSelection({
	deployConfig,
	env,
	systems,
	skipUnavailable,
}: {
	deployConfig: TreeseedDeployConfig;
	env: NodeJS.ProcessEnv | Record<string, string | undefined>;
	systems?: unknown;
	skipUnavailable?: boolean;
}): TreeseedBootstrapSelection {
	const requested = parseTreeseedBootstrapSystems(systems);
	const explicit = !(systems === undefined || systems === null) && requested.length > 0;
	const selected = requested.includes('all')
		? [...TREESEED_BOOTSTRAP_SYSTEMS]
		: requested as TreeseedRunnableBootstrapSystem[];
	const expanded = expandBootstrapSystems(selected);
	const defaultSkipUnavailable = requested.includes('all');
	const effectiveSkipUnavailable = skipUnavailable ?? defaultSkipUnavailable;
	const canSkipUnavailable = (system: TreeseedRunnableBootstrapSystem) =>
		effectiveSkipUnavailable && (skipUnavailable === true || system === 'api' || system === 'agents');
	const statuses: TreeseedBootstrapSystemStatus[] = [];
	const configDisabled: TreeseedBootstrapSystemStatus[] = [];
	const unavailable: TreeseedBootstrapSystemStatus[] = [];
	const skipped: TreeseedBootstrapSystemStatus[] = [];
	const runnable: TreeseedRunnableBootstrapSystem[] = [];

	for (const system of expanded) {
		const disabledReason = system === 'api'
			? apiSystemDisabled(deployConfig)
			: system === 'agents'
				? agentsSystemDisabled(deployConfig)
				: null;
		if (disabledReason) {
			const status = { system, status: 'config_disabled', reason: disabledReason, missing: [] } satisfies TreeseedBootstrapSystemStatus;
			configDisabled.push(status);
			skipped.push(status);
			statuses.push(status);
			continue;
		}
		const missing = missingForSystem(system, env);
		if (missing.length > 0) {
			const reason = `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not configured.`;
			const status = {
				system,
				status: 'unavailable',
				reason,
				missing,
			} satisfies TreeseedBootstrapSystemStatus;
			if (!canSkipUnavailable(system) && (selected.includes(system) || !requested.includes('all'))) {
				unavailable.push(status);
				statuses.push(status);
				continue;
			}
			unavailable.push(status);
			skipped.push(status);
			statuses.push(status);
			continue;
		}
		const status = {
			system,
			status: selected.includes(system) ? 'selected' : 'included_dependency',
			reason: selected.includes(system) ? 'Selected for bootstrap.' : 'Included as a dependency.',
			missing: [],
		} satisfies TreeseedBootstrapSystemStatus;
		runnable.push(system);
		statuses.push(status);
	}

	return {
		requested,
		explicit,
		skipUnavailable: effectiveSkipUnavailable,
		selected,
		expanded,
		runnable,
		configDisabled,
		unavailable,
		skipped,
		statuses,
	};
}

export function bootstrapSystemForUnit(unit: TreeseedDesiredUnit): TreeseedRunnableBootstrapSystem {
	const metadataSystem = unit.metadata?.bootstrapSystem;
	if (typeof metadataSystem === 'string' && BOOTSTRAP_SYSTEM_SET.has(metadataSystem)) {
		return metadataSystem as TreeseedRunnableBootstrapSystem;
	}
	if (unit.unitType === 'queue' || unit.unitType === 'database' || unit.unitType === 'content-store') {
		return 'data';
	}
	if (unit.unitType === 'api-runtime' || unit.unitType === 'railway-service:api' || unit.unitType === 'custom-domain:api') {
		return 'api';
	}
	if (unit.unitType.startsWith('railway-service:') || unit.unitType.endsWith('-runtime')) {
		return 'agents';
	}
	return 'web';
}

export function filterTreeseedDesiredUnitsByBootstrapSystems(
	units: TreeseedDesiredUnit[],
	systems?: TreeseedRunnableBootstrapSystem[],
) {
	if (!systems || systems.length === 0) {
		return units;
	}
	const allowed = new Set(systems);
	return units.filter((unit) => allowed.has(bootstrapSystemForUnit(unit)));
}
