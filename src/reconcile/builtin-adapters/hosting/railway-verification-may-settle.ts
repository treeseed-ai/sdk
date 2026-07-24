import { deleteRailwayService, deleteRailwayVolume, listRailwayVolumes } from "../../../operations/services/hosting/railway/railway-api.ts";
import type { ObservedUnitState, ReconcileAdapterInput, ReconcileResult, ReconcileUnitDiff, UnitVerificationResult } from "../../support/contracts/contracts.ts";
import { configuredRailwayServicesForInput, resolveRailwayTopologyForScope, traceRailwayReconcile } from './resolve-railway-topology-for-scope.ts';
import { buildRailwayEnv, providerCache } from '../reconciliation/build-workflow-meta-adapter.ts';
import { syncRailwayEnvironmentForScope } from './sync-railway-environment-for-scope.ts';
import { isTransientRailwayReconcileError, nowIso, sleepMs } from './to-deploy-target.ts';
import { observeRailwayUnit } from './observe-railway-unit.ts';

export function railwayVerificationMaySettle(verification: UnitVerificationResult) {
	return verification.checks.some((check) =>
		!check.verified
		&& (
			check.key === 'railway.instance'
			|| check.key.startsWith('railway.instance.')
			|| check.key === 'railway.service.source-mode'
			|| check.key === 'railway.volume:data'
		),
	);
}

export function railwayStartCommandMatches(serviceKey: string, observed: string | null | undefined, expected: string) {
	if (observed === expected) {
		return true;
	}
	if (serviceKey !== 'operationsRunner') {
		return false;
	}
	const normalizedObserved = String(observed ?? '').trim().replace(/\s+/gu, ' ');
	const normalizedExpected = String(expected ?? '').trim().replace(/\s+/gu, ' ');
	if (normalizedObserved === normalizedExpected) {
		return true;
	}
	const allowedInlineEnv = [
		'TREESEED_MANAGER_ID',
		'TREESEED_PLATFORM_RUNNER_ID',
		'TREESEED_PLATFORM_RUNNER_DATA_DIR',
		'TREESEED_PLATFORM_RUNNER_ENVIRONMENT',
	];
	let remainder = normalizedObserved;
	for (const key of allowedInlineEnv) {
		remainder = remainder.replace(new RegExp(`^${key}=[^\\s]+\\s+`, 'u'), '');
	}
	return remainder === normalizedExpected;
}

export function railwayProjectServiceKeys(
	input: ReconcileAdapterInput,
	scope: EnvironmentScope,
	configuredService: ReturnType<typeof configuredRailwayServicesForInput>[number],
) {
	return configuredRailwayServicesForInput(input, scope)
		.filter((candidate) => candidate.projectName === configuredService.projectName
			&& candidate.railwayEnvironment === configuredService.railwayEnvironment)
		.map((candidate) => candidate.key);
}

export function railwayUnitServiceIdentity(input: ReconcileAdapterInput) {
	return String(input.unit.metadata.serviceInstanceKey ?? input.unit.spec.serviceName ?? input.unit.metadata.serviceKey ?? '').trim();
}

export function configuredRailwayServiceForUnit(
	input: ReconcileAdapterInput,
	scope: EnvironmentScope,
) {
	const identity = railwayUnitServiceIdentity(input);
	const serviceKey = String(input.unit.metadata.serviceKey ?? '').trim();
	return configuredRailwayServicesForInput(input, scope)
		.find((candidate) => candidate.instanceKey === identity
			|| candidate.serviceName === identity
			|| candidate.key === identity
			|| candidate.key === serviceKey) ?? null;
}

export function findRailwayTopologyEntry(
	topology: Awaited<ReturnType<typeof resolveRailwayTopologyForScope>>,
	identity: string,
) {
	return topology.services.get(identity)
		?? [...topology.services.values()].find((entry) =>
			entry.configuredService.instanceKey === identity
			|| entry.configuredService.serviceName === identity
			|| entry.configuredService.key === identity)
		?? null;
}

export async function resolveRailwayUnitTopology(
	input: ReconcileAdapterInput,
	scope: EnvironmentScope,
	options: { refresh: boolean; includeInstances: boolean; includeVariables: boolean; cacheSuffix?: string },
) {
	const configuredService = configuredRailwayServiceForUnit(input, scope);
	const serviceKeys = configuredService
		? railwayProjectServiceKeys(input, scope, configuredService)
		: [String(input.unit.metadata.serviceKey ?? '').trim()];
	const projectKey = configuredService
		? `${configuredService.projectName}:${configuredService.railwayEnvironment}`
		: serviceKeys.join(',');
	const load = () => resolveRailwayTopologyForScope(input, scope, {
		refresh: options.refresh,
		serviceKeys,
		includeInstances: options.includeInstances,
		includeVariables: options.includeVariables,
	});
	return options.cacheSuffix
		? await providerCache(input, `railway:unit-topology:${scope}:${projectKey}:${options.cacheSuffix}`, load)
		: await load();
}

export async function buildRailwayDiff(input: ReconcileAdapterInput, observed: ObservedUnitState): Promise<ReconcileUnitDiff> {
	const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
	const serviceKey = String(input.unit.metadata.serviceKey ?? '').trim();
	const configuredService = configuredRailwayServiceForUnit(input, scope);
	const projectServiceKeys = configuredService ? railwayProjectServiceKeys(input, scope, configuredService) : [];
	const projectPlan = configuredService
		? await providerCache(input, `railway:plan:${scope}:${configuredService.projectName}:${configuredService.railwayEnvironment}`, () =>
			syncRailwayEnvironmentForScope(input, { planOnly: true, serviceKeys: projectServiceKeys }))
		: null;
	const plannedChanges = projectPlan?.projectPlans?.flatMap((plan) => plan.changes) ?? [];
	const planReasons = plannedChanges.map((change) => change.summary || `${change.kind} ${change.path}`);
	if (!observed.exists) {
		return {
			action: 'create',
			reasons: ['service missing from configured topology', ...planReasons],
			before: observed.live,
			after: { ...input.unit.spec, railwayProjectChanges: plannedChanges },
		};
	}
	if (plannedChanges.length > 0) {
		return {
			action: 'update',
			reasons: planReasons,
			before: observed.live,
			after: { ...input.unit.spec, railwayProjectChanges: plannedChanges },
		};
	}
	return {
		action: observed.status === 'ready' ? 'noop' : 'update',
		reasons: observed.status === 'ready' ? ['service already configured'] : ['service requires configuration sync'],
		before: observed.live,
		after: input.unit.spec,
	};
}

export async function reconcileRailwayUnit(input: ReconcileAdapterInput, diff: ReconcileUnitDiff): Promise<ReconcileResult> {
	const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
	const serviceKey = String(input.unit.metadata.serviceKey ?? '').trim();
	const configuredService = configuredRailwayServiceForUnit(input, scope);
	const requiresProjectLevelSync = Boolean(configuredService);
	const serviceKeys = configuredService
		? railwayProjectServiceKeys(input, scope, configuredService)
		: serviceKey
			? [serviceKey]
			: undefined;
	const cacheKey = requiresProjectLevelSync
		? `railway:sync:${scope}:project:${configuredService?.projectName ?? 'default'}:${configuredService?.railwayEnvironment ?? scope}`
		: `railway:sync:${scope}:${serviceKey || 'all'}`;
	let attempt = 0;
	for (;;) {
		try {
			await providerCache(input, cacheKey, async () => {
				const synced = await syncRailwayEnvironmentForScope(input, { serviceKeys });
				return synced;
			});
			break;
		} catch (error) {
			if (attempt >= 2 || !isTransientRailwayReconcileError(error)) {
				throw error;
			}
			attempt += 1;
			sleepMs(1000 * attempt);
		}
	}
	const postApplyTopology = await providerCache(input, `${cacheKey}:post-apply-topology`, async () => {
		for (const key of input.context.session.keys()) {
			if (key.startsWith(`railway:topology:${scope}:`) || key.startsWith(`railway:unit-topology:${scope}:`)) {
				input.context.session.delete(key);
			}
		}
		return resolveRailwayUnitTopology(input, scope, {
			refresh: true,
			includeInstances: false,
			includeVariables: false,
			cacheSuffix: 'post-apply',
		});
	});
	const refreshed = await observeRailwayUnit(input, { topology: await postApplyTopology });
	return {
		unit: input.unit,
		observed: refreshed,
		diff,
		action: diff.action === 'update' || diff.action === 'create' ? 'update' : diff.action,
		warnings: refreshed.warnings,
		resourceLocators: refreshed.locators,
		state: refreshed.live,
		verification: null,
	};
}

export async function destroyRailwayUnit(input: ReconcileAdapterInput): Promise<ReconcileResult> {
	const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
	const serviceKey = String(input.unit.metadata.serviceKey ?? '').trim();
	const env = buildRailwayEnv(input, scope);
	const live = input.observed.live as Record<string, unknown>;
	const project = live.project && typeof live.project === 'object' ? live.project as Record<string, unknown> : null;
	const environment = live.environment && typeof live.environment === 'object' ? live.environment as Record<string, unknown> : null;
	const service = live.service && typeof live.service === 'object' ? live.service as Record<string, unknown> : null;
	const projectId = String(project?.id ?? input.observed.locators.projectId ?? '').trim();
	const environmentId = String(environment?.id ?? '').trim();
	const serviceId = String(service?.id ?? input.observed.locators.serviceId ?? '').trim();
	const serviceName = String(service?.name ?? input.observed.locators.serviceName ?? serviceKey).trim();
	const deletedVolumes: Array<Record<string, unknown>> = [];

	if (projectId && serviceId) {
		const volumes = await listRailwayVolumes({ projectId, env }).catch(() => []);
		for (const volume of volumes) {
			const attached = volume.instances.some((instance) =>
				instance.serviceId === serviceId
				&& (!environmentId || instance.environmentId === environmentId)
			);
			if (!attached) continue;
			traceRailwayReconcile(env, 'destroy:volume', `${serviceName}:${volume.name ?? volume.id}:${volume.id}`);
			const result = await deleteRailwayVolume({ projectId, environmentId, volumeId: volume.id, env });
			deletedVolumes.push({
				id: volume.id,
				name: volume.name ?? null,
				status: result.status,
			});
		}
	}

	let deletedService: Record<string, unknown> | null = null;
	if (serviceId) {
		traceRailwayReconcile(env, 'destroy:service', `${serviceName}:${serviceId}`);
		deletedService = await deleteRailwayService({ projectId, environmentId, serviceId, env });
	}

	for (const key of input.context.session.keys()) {
		if (key.startsWith(`railway:topology:${scope}:`)) {
			input.context.session.delete(key);
		}
	}
	const state = {
		...live,
		destroyedAt: nowIso(),
		deletedService,
		deletedVolumes,
	};
	return {
		unit: input.unit,
		observed: input.observed,
		diff: {
			action: 'delete',
			reasons: ['selected Railway service for destroy'],
			before: input.observed.live,
			after: {},
		},
		action: 'delete',
		warnings: input.observed.warnings,
		resourceLocators: input.observed.locators,
		state,
		verification: null,
	};
}
