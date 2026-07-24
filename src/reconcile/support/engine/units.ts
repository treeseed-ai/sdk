import type { DesiredUnit, ReconcileTarget, ReconcileUnitId, ReconcileUnitType } from '../contracts/contracts.ts';

export const TRESEED_RECONCILE_UNIT_TYPES: ReconcileUnitType[] = [
	'web-ui',
	'api-runtime',
	'operations-runner-runtime',
	'workday-manager-runtime',
	'worker-runner-runtime',
	'edge-worker',
	'content-store',
	'queue',
	'database',
	'kv-form-guard',
	'turnstile-widget',
	'pages-project',
	'custom-domain:web',
	'custom-domain:api',
	'dns-record',
	'railway-service:api',
	'railway-service:operations-runner',
	'railway-service:workday-manager',
	'railway-service:worker-runner',
	'branch-preview',
	'branch-preview-cleanup',
	'workflow-gate',
	'save-gate:local-verify',
	'save-gate:promotion-readiness',
	'save-gate:hosted-verify',
];

export function targetKey(target: ReconcileTarget) {
	return target.kind === 'persistent' ? target.scope : `branch:${target.branchName}`;
}

export function createReconcileUnitId(unitType: ReconcileUnitType, logicalName: string) {
	return `${unitType}:${logicalName}` satisfies ReconcileUnitId;
}

export function topologicallySortDesiredUnits(units: DesiredUnit[]) {
	const byId = new Map(units.map((unit) => [unit.unitId, unit]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const output: DesiredUnit[] = [];

	const visit = (unit: DesiredUnit) => {
		if (visited.has(unit.unitId)) {
			return;
		}
		if (visiting.has(unit.unitId)) {
			throw new Error(`Treeseed reconcile dependency cycle detected at ${unit.unitId}.`);
		}
		visiting.add(unit.unitId);
		for (const dependencyId of unit.dependencies) {
			const dependency = byId.get(dependencyId);
			if (!dependency) {
				throw new Error(`Treeseed reconcile dependency ${dependencyId} referenced by ${unit.unitId} is missing.`);
			}
			visit(dependency);
		}
		visiting.delete(unit.unitId);
		visited.add(unit.unitId);
		output.push(unit);
	};

	for (const unit of units) {
		visit(unit);
	}

	return output;
}

export function reverseTopologicallySortedUnits(units: DesiredUnit[]) {
	return [...topologicallySortDesiredUnits(units)].reverse();
}
