import type { TreeseedDesiredUnit, TreeseedReconcileTarget, TreeseedReconcileUnitId, TreeseedReconcileUnitType } from './contracts.ts';

export const TRESEED_RECONCILE_UNIT_TYPES: TreeseedReconcileUnitType[] = [
	'web-ui',
	'api-runtime',
	'market-operations-runner-runtime',
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
	'railway-service:market-operations-runner',
	'railway-service:workday-manager',
	'railway-service:worker-runner',
];

export function targetKey(target: TreeseedReconcileTarget) {
	return target.kind === 'persistent' ? target.scope : `branch:${target.branchName}`;
}

export function createTreeseedReconcileUnitId(unitType: TreeseedReconcileUnitType, logicalName: string) {
	return `${unitType}:${logicalName}` satisfies TreeseedReconcileUnitId;
}

export function topologicallySortDesiredUnits(units: TreeseedDesiredUnit[]) {
	const byId = new Map(units.map((unit) => [unit.unitId, unit]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const output: TreeseedDesiredUnit[] = [];

	const visit = (unit: TreeseedDesiredUnit) => {
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

export function reverseTopologicallySortedUnits(units: TreeseedDesiredUnit[]) {
	return [...topologicallySortDesiredUnits(units)].reverse();
}
