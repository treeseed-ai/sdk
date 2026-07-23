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
import { canonicalActionKind, railwayReconcileSystemsForUnits, serializeHostingUnit } from './assert-capability-binding.ts';
import { ENVIRONMENT_NAMES } from './railway-service-name-max-length.ts';

export function canonicalHostingNode(unit: TreeseedHostingUnit, value?: unknown): TreeseedCanonicalGraphNode {
	return {
		id: unit.id,
		provider: unit.host.id,
		type: unit.serviceType.id,
		owner: unit.application?.id ?? null,
		environment: unit.environment,
		spec: serializeHostingUnit(unit),
		state: value,
		locators: {
			hostId: unit.host.id,
			projectGroupId: unit.projectGroup?.id ?? null,
			serviceTypeId: unit.serviceType.id,
		},
		metadata: {
			placement: unit.placement,
			logicalName: unit.logicalName,
		},
	};
}

export function canonicalHostingDrift(unit: TreeseedHostingUnit, entries: unknown, fallbackReason: string): TreeseedCanonicalDrift[] {
	const rawEntries = Array.isArray(entries) ? entries : [];
	if (rawEntries.length === 0) return [];
	return rawEntries.map((entry, index) => ({
		id: `${unit.id}:drift:${index + 1}`,
		resourceId: unit.id,
		severity: 'blocking',
		reason: typeof entry === 'string' ? entry : fallbackReason,
		provider: unit.host.id,
		type: unit.serviceType.id,
		observed: entry,
	}));
}

export function canonicalHostingPostcondition(unit: TreeseedHostingUnit, verification: { verified?: boolean; checks?: unknown[]; issues?: unknown[] }) {
	const issues = [
		...(Array.isArray(verification.issues) ? verification.issues.map(String) : []),
		...(Array.isArray(verification.checks)
			? verification.checks.flatMap((check) => {
				if (!check || typeof check !== 'object') return [];
				const maybeIssues = (check as { issues?: unknown }).issues;
				return Array.isArray(maybeIssues) ? maybeIssues.map(String) : [];
			})
			: []),
	];
	return {
		id: `${unit.id}:verified`,
		resourceId: unit.id,
		description: `Live postconditions pass for ${unit.logicalName}.`,
		source: 'sdk',
		required: true,
		ok: verification.verified === true,
		issues,
		observed: verification,
	} satisfies TreeseedCanonicalPostcondition;
}

export function hostingPlanReason(plan: { action?: unknown; reasons?: string[] }, prefix: string) {
	return plan.reasons?.length ? plan.reasons.join('; ') : `${prefix} ${String(plan.action ?? 'noop')}.`;
}

export function canonicalHostingReportFromPlan(plan: TreeseedHostingPlan) {
	const desiredGraph = plan.units.map((entry) => canonicalHostingNode(entry.unit));
	const observedGraph = plan.units.map((entry) => canonicalHostingNode(entry.unit, entry.observed));
	const diff = plan.units.flatMap((entry) => [
		...(entry.plan.action && entry.plan.action !== 'noop'
			? [{
				id: `${entry.unit.id}:diff`,
				resourceId: entry.unit.id,
				severity: canonicalActionKind(entry.plan.action) === 'blocked' ? 'blocking' : 'info',
				reason: hostingPlanReason(entry.plan, 'Planned'),
				provider: entry.unit.host.id,
				type: entry.unit.serviceType.id,
				expected: serializeHostingUnit(entry.unit),
				observed: entry.observed,
			} satisfies TreeseedCanonicalDrift]
			: []),
		...canonicalHostingDrift(entry.unit, entry.plan.blockedDrift, 'Blocked provider drift.'),
	]);
	const providerLimitations = plan.units.flatMap((entry) => canonicalHostingDrift(entry.unit, entry.plan.providerLimitations, 'Provider limitation.'));
	const actions = plan.units.map((entry) => ({
		id: `${entry.unit.id}:${entry.plan.action ?? 'noop'}`,
		kind: canonicalActionKind(entry.plan.action),
		resourceId: entry.unit.id,
		reason: hostingPlanReason(entry.plan, 'Planned'),
		provider: entry.unit.host.id,
		type: entry.unit.serviceType.id,
		before: entry.observed,
		after: serializeHostingUnit(entry.unit),
	} satisfies TreeseedCanonicalAction));
	return createTreeseedCanonicalReconcileReport({
		desiredGraph,
		observedGraph,
		stateGraph: [],
		diff,
		actions,
		postconditions: plan.units.map((entry) => canonicalHostingPostcondition(entry.unit, entry.verification)),
		selectedResources: plan.units.map((entry) => entry.unit.id),
		skippedResources: [],
		blockedDrift: diff.filter((entry) => entry.severity === 'blocking'),
		providerLimitations,
		retainedResources: plan.units.flatMap((entry) => (entry.plan.retainedResources ?? []).map((resource: unknown, index: number) => ({
			id: `${entry.unit.id}:retained:${index + 1}`,
			provider: entry.unit.host.id,
			type: 'retained-resource',
			owner: entry.unit.application?.id ?? null,
			state: resource,
		}))),
		liveVerification: {
			ok: plan.units.every((entry) => entry.verification.verified === true),
			source: 'hosting-plan',
			issues: plan.units
				.filter((entry) => entry.verification.verified !== true)
				.map((entry) => `${entry.unit.id}: verification did not pass`),
		},
	});
}

export function serializeHostingPlan(plan: TreeseedHostingPlan) {
	const selectedSystems = railwayReconcileSystemsForUnits(plan.units.map((entry) => entry.unit));
	const canonical = canonicalHostingReportFromPlan(plan);
	return {
		environment: plan.environment,
		planOnly: plan.planOnly,
		...canonical,
		selectedApps: [...new Set(plan.units.map((entry) => entry.unit.application?.id).filter((value): value is string => Boolean(value)))],
		selectedSystems,
		skippedSystems: ['web', 'data', 'github']
			.filter((system) => !selectedSystems.includes(system as TreeseedRunnableBootstrapSystem))
			.map((system) => ({ system, reason: selectedSystems.length > 0 ? 'Not selected by hosting app filter.' : 'No Railway reconciliation selected.' })),
		transport: selectedSystems.length > 0
			? {
				railway: {
					reconcile: 'api',
					deploy: process.env.TREESEED_RAILWAY_DEPLOY_TRANSPORT === 'cli-fallback' ? 'cli-fallback' : 'api',
				},
			}
			: undefined,
		placements: plan.placements,
		units: plan.units.map((entry) => ({
			unit: serializeHostingUnit(entry.unit),
			desired: serializeHostingUnit(entry.unit),
			observed: entry.observed,
			diff: entry.plan,
			actions: entry.plan.actions ?? [entry.plan.action],
			retainedResources: entry.plan.retainedResources ?? [],
			blockedDrift: entry.plan.blockedDrift ?? [],
			providerLimitations: entry.plan.providerLimitations ?? [],
			plan: entry.plan,
			verification: entry.verification,
		})),
		warnings: plan.warnings,
	};
}

export function hostingEnvironmentLabel(environment: TreeseedHostingEnvironment) {
	return ENVIRONMENT_NAMES[environment];
}
