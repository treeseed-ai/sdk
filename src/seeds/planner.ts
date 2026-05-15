import type { NormalizedSeedResource, SeedCurrentResource, SeedDiagnostic, SeedEnvironment, SeedManifest, SeedPlan, SeedPlanAction, SeedPlanActionType, SeedPlanSummary } from './types.js';
import { normalizeSeedResources } from './normalize.js';

const ACTION_TYPES: SeedPlanActionType[] = ['create', 'update', 'unchanged', 'skip', 'delete', 'error'];

function emptySummary(): SeedPlanSummary {
	return {
		create: 0,
		update: 0,
		unchanged: 0,
		skip: 0,
		delete: 0,
		error: 0,
	};
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableJson).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function toAction(resource: NormalizedSeedResource, currentByKey: Map<string, SeedCurrentResource>): SeedPlanAction {
	if (resource.environments.length === 0) {
		return {
			...resource,
			action: 'skip',
			reason: 'Resource does not target the selected environments.',
		};
	}
	const current = currentByKey.get(resource.key);
	if (current) {
		return {
			...resource,
			action: stableJson(resource.payload) === stableJson(current.payload) ? 'unchanged' : 'update',
			existing: current.existing ?? null,
		};
	}
	return {
		...resource,
		action: 'create',
	};
}

export function createSeedPlan(input: {
	manifest: SeedManifest;
	manifestPath: string;
	environments: SeedEnvironment[];
	mode: SeedPlan['mode'];
	diagnostics?: SeedDiagnostic[];
	currentResources?: SeedCurrentResource[];
}): SeedPlan {
	const currentByKey = new Map((input.currentResources ?? []).map((resource) => [resource.key, resource]));
	const actions = normalizeSeedResources(input.manifest, input.environments).map((resource) => toAction(resource, currentByKey));
	const summary = emptySummary();
	for (const action of actions) {
		summary[action.action] += 1;
	}
	for (const actionType of ACTION_TYPES) {
		summary[actionType] += 0;
	}
	return {
		ok: summary.error === 0 && !(input.diagnostics ?? []).some((diagnostic) => diagnostic.severity === 'error'),
		seed: input.manifest.name,
		version: input.manifest.version,
		mode: input.mode,
		environments: input.environments,
		summary,
		actions,
		diagnostics: input.diagnostics ?? [],
		manifestPath: input.manifestPath,
	};
}

function actionKindLabel(action: SeedPlanAction) {
	switch (action.kind) {
		case 'repositoryHost':
			return 'repository host';
		case 'hubRepository':
			return 'hub repository';
		case 'capacityProvider':
			return 'capacity provider';
		case 'capacityLane':
			return 'lane';
		case 'capacityGrant':
			return 'grant';
		case 'workPolicy':
			return 'work policy';
		case 'catalogArtifact':
			return 'catalog artifact';
		default:
			return action.kind;
	}
}

export function formatSeedPlan(plan: SeedPlan) {
	const lines = [
		`Seed: ${plan.seed}`,
		`Environments: ${plan.environments.join(', ')}`,
		'',
	];
	for (const action of plan.actions) {
		if (action.action === 'skip') continue;
		lines.push(`${action.action.toUpperCase()} ${actionKindLabel(action)} ${action.label}`);
	}
	if (lines[lines.length - 1] !== '') {
		lines.push('');
	}
	lines.push(
		'Summary:',
		`  create: ${plan.summary.create}`,
		`  update: ${plan.summary.update}`,
		`  unchanged: ${plan.summary.unchanged}`,
		`  skipped: ${plan.summary.skip}`,
		`  errors: ${plan.summary.error}`,
	);
	return lines;
}
