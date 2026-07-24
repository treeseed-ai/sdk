import type { DeployConfig } from '../../platform/support/contracts.ts';
import type { DesiredUnit } from './contracts/contracts.ts';

export const BOOTSTRAP_SYSTEMS = ['github', 'data', 'web', 'api', 'agents'] as const;
export type BootstrapSystem = typeof BOOTSTRAP_SYSTEMS[number] | 'all';
export type RunnableBootstrapSystem = Exclude<BootstrapSystem, 'all'>;

const BOOTSTRAP_SYSTEM_SET = new Set<string>(BOOTSTRAP_SYSTEMS);
const SYSTEM_DEPENDENCIES: Record<RunnableBootstrapSystem, RunnableBootstrapSystem[]> = {
	github: [],
	data: [],
	web: ['data'],
	api: ['data'],
	agents: [],
};

export type BootstrapSystemStatus = {
	system: RunnableBootstrapSystem;
	status: 'selected' | 'included_dependency' | 'config_disabled' | 'unavailable' | 'skipped';
	reason: string;
	missing: string[];
};

export type BootstrapSelection = {
	requested: BootstrapSystem[];
	explicit: boolean;
	skipUnavailable: boolean;
	selected: RunnableBootstrapSystem[];
	expanded: RunnableBootstrapSystem[];
	runnable: RunnableBootstrapSystem[];
	configDisabled: BootstrapSystemStatus[];
	unavailable: BootstrapSystemStatus[];
	skipped: BootstrapSystemStatus[];
	statuses: BootstrapSystemStatus[];
};

function uniqueSystems(values: BootstrapSystem[]) {
	return [...new Set(values)] as BootstrapSystem[];
}

export function parseBootstrapSystems(value: unknown): BootstrapSystem[] {
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
		throw new Error(`Unknown Treeseed bootstrap system "${invalid[0]}". Expected one of all, ${BOOTSTRAP_SYSTEMS.join(', ')}.`);
	}
	return uniqueSystems(systems as BootstrapSystem[]);
}

function expandBootstrapSystems(systems: RunnableBootstrapSystem[]) {
	const expanded = new Set<RunnableBootstrapSystem>();
	const visit = (system: RunnableBootstrapSystem) => {
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

function serviceEnabled(config: DeployConfig, serviceKey: string) {
	const service = config.services?.[serviceKey];
	return Boolean(service && service.enabled !== false && (service.provider ?? 'railway') === 'railway');
}

function apiSystemDisabled(config: DeployConfig) {
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

function agentsSystemDisabled(config: DeployConfig) {
	if (config.runtime?.mode === 'none') {
		return 'runtime.mode is none.';
	}
	const enabled = ['operationsRunner', 'workdayManager', 'workerRunner'].some((serviceKey) => serviceEnabled(config, serviceKey));
	return enabled ? null : 'No agent or Treeseed operations runner Railway services are enabled.';
}

function hasValue(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string) {
	return typeof env[key] === 'string' && String(env[key]).trim().length > 0;
}

function missingForSystem(system: RunnableBootstrapSystem, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	switch (system) {
		case 'github':
			return hasValue(env, 'TREESEED_GITHUB_TOKEN') ? [] : ['TREESEED_GITHUB_TOKEN'];
		case 'data':
		case 'web':
			return hasValue(env, 'TREESEED_CLOUDFLARE_API_TOKEN') ? [] : ['TREESEED_CLOUDFLARE_API_TOKEN'];
		case 'api':
		case 'agents':
			return hasValue(env, 'TREESEED_RAILWAY_API_TOKEN') ? [] : ['TREESEED_RAILWAY_API_TOKEN'];
		default:
			return [];
	}
}

export function resolveBootstrapSelection({
	deployConfig,
	env,
	systems,
	skipUnavailable,
}: {
	deployConfig: DeployConfig;
	env: NodeJS.ProcessEnv | Record<string, string | undefined>;
	systems?: unknown;
	skipUnavailable?: boolean;
}): BootstrapSelection {
	const requested = parseBootstrapSystems(systems);
	const explicit = !(systems === undefined || systems === null) && requested.length > 0;
	const selected = requested.includes('all')
		? [...BOOTSTRAP_SYSTEMS]
		: requested as RunnableBootstrapSystem[];
	const expanded = expandBootstrapSystems(selected);
	const defaultSkipUnavailable = requested.includes('all');
	const effectiveSkipUnavailable = skipUnavailable ?? defaultSkipUnavailable;
	const canSkipUnavailable = (system: RunnableBootstrapSystem) =>
		effectiveSkipUnavailable && (skipUnavailable === true || system === 'api' || system === 'agents');
	const statuses: BootstrapSystemStatus[] = [];
	const configDisabled: BootstrapSystemStatus[] = [];
	const unavailable: BootstrapSystemStatus[] = [];
	const skipped: BootstrapSystemStatus[] = [];
	const runnable: RunnableBootstrapSystem[] = [];

	for (const system of expanded) {
		const disabledReason = system === 'api'
			? apiSystemDisabled(deployConfig)
			: system === 'agents'
				? agentsSystemDisabled(deployConfig)
				: null;
		if (disabledReason) {
			const status = { system, status: 'config_disabled', reason: disabledReason, missing: [] } satisfies BootstrapSystemStatus;
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
			} satisfies BootstrapSystemStatus;
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
		} satisfies BootstrapSystemStatus;
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

export function bootstrapSystemForUnit(unit: DesiredUnit): RunnableBootstrapSystem {
	const metadataSystem = unit.metadata?.bootstrapSystem;
	if (typeof metadataSystem === 'string' && BOOTSTRAP_SYSTEM_SET.has(metadataSystem)) {
		return metadataSystem as RunnableBootstrapSystem;
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

export function filterDesiredUnitsByBootstrapSystems(
	units: DesiredUnit[],
	systems?: RunnableBootstrapSystem[],
) {
	if (!systems || systems.length === 0) {
		return units;
	}
	const allowed = new Set(systems);
	return units.filter((unit) => allowed.has(bootstrapSystemForUnit(unit)));
}
