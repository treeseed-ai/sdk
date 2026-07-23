import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
	discoverTreeseedPackageAdapters,
	type TreeseedPackageAdapter,
} from '../../operations/services/package-adapters.ts';
import { redactCapacityProviderEnv, validateAndDigestCapacityProviderManifest } from '../../capacity-provider.ts';
import { workspaceRoot } from '../../operations/services/workspace-tools.ts';
import {
	checkedOutTemplateRepositories,
	type TreeseedTemplateRepositoryManifest,
} from '../../operations/services/managed-repositories.ts';
import { deriveTreeseedDesiredUnits } from '../../reconcile/desired-state.ts';
import type { TreeseedDesiredUnit, TreeseedReconcileSelector, TreeseedReconcileTarget } from '../../reconcile/contracts.ts';
import {
	buildProjectLocalContentResources,
	type TreeseedLocalContentMode,
} from '../local-content-materialization.ts';
import { localTreeDxSeedDigest } from '../local-treedx-seed.ts';
import { TreeseedDesiredResource, TreeseedDesiredResourceEdge, TreeseedDesiredResourceGraph, environmentFromTarget, hashJson, packageUnitFromAdapter, reconcileIdentityForGraph, templateUnitFromRepository } from './treeseed-desired-environment.ts';
import { resourceFromUnit } from './safe-tree-dx-repository-name.ts';
import { packageResources, templateResources } from './package-resources.ts';
import { localDevelopmentResources } from './local-development-resources.ts';
import { branchPreviewResources, releaseGateResources, resourceMatchesSelector } from './release-gate-resources.ts';

export function compileTreeseedDesiredResourceGraph({
	tenantRoot = workspaceRoot(),
	target,
	localContent = 'auto',
	capacityConfigPath,
}: {
	tenantRoot?: string;
	target: TreeseedReconcileTarget;
	localContent?: TreeseedLocalContentMode;
	capacityConfigPath?: string;
}): TreeseedDesiredResourceGraph {
	const environment = environmentFromTarget(target);
	const derived = deriveTreeseedDesiredUnits({ tenantRoot, target });
	const packageAdapters = discoverTreeseedPackageAdapters(tenantRoot);
	const packages = packageAdapters.map(packageUnitFromAdapter);
	const templates = checkedOutTemplateRepositories(tenantRoot).map(templateUnitFromRepository);
	const resources = [
		...derived.units.map((unit) => resourceFromUnit(unit, environment)),
		...packageAdapters.flatMap((adapter) => packageResources(adapter, environment)),
		...templateResources(templates, environment),
		...localDevelopmentResources(tenantRoot, environment, localContent, templates, capacityConfigPath),
		...branchPreviewResources(target, environment),
		...releaseGateResources(packages, templates, environment),
	];
	const edges: TreeseedDesiredResourceEdge[] = resources.flatMap((resource) =>
		resource.dependencies.map((dependency) => ({
			from: dependency,
			to: resource.id,
			reason: 'depends-on' as const,
		})));
	const fingerprints = Object.fromEntries(resources.map((resource) => [resource.id, hashJson(resource)]));
	return {
		workspaceId: derived.deployConfig.slug,
		environment,
		packages,
		templates,
		resources,
		edges,
		fingerprints,
	};
}

export function selectTreeseedDesiredResources(
	graph: TreeseedDesiredResourceGraph,
	selector?: TreeseedReconcileSelector,
): TreeseedDesiredResourceGraph {
	if (!selector) return graph;
	const selected = graph.resources.filter((resource) => resourceMatchesSelector(resource, selector));
	const selectedIds = new Set(selected.map((resource) => resource.id));
	const include = new Map(selected.map((resource) => [resource.id, resource]));
	const byId = new Map(graph.resources.map((resource) => [resource.id, resource]));
	const visit = (resource: TreeseedDesiredResource) => {
		for (const dependencyId of resource.dependencies) {
			const dependency = byId.get(dependencyId);
			if (!dependency || include.has(dependency.id)) continue;
			include.set(dependency.id, dependency);
			visit(dependency);
		}
	};
	for (const resource of selected) visit(resource);
	const resources = graph.resources.filter((resource) => include.has(resource.id));
	const resourceIds = new Set(resources.map((resource) => resource.id));
	return {
		...graph,
		resources,
		edges: graph.edges.filter((edge) => resourceIds.has(edge.from) && resourceIds.has(edge.to)),
		fingerprints: Object.fromEntries(Object.entries(graph.fingerprints).filter(([id]) => resourceIds.has(id))),
		packages: graph.packages.filter((pkg) =>
			resources.some((resource) => resource.packageId === pkg.id) || selectedIds.size === 0),
		templates: graph.templates.filter((template) =>
			resources.some((resource) => resource.packageId === template.id) || selectedIds.size === 0),
	};
}

export function convertDesiredResourceToReconcileUnit(
	graph: TreeseedDesiredResourceGraph,
	resource: TreeseedDesiredResource,
): TreeseedDesiredUnit | null {
	const identity = reconcileIdentityForGraph(graph.workspaceId, graph.environment);
	if (resource.source.type !== 'reconcile-unit') {
		const unitType = (() => {
			if (resource.kind === 'release-gate') return String(resource.spec.gateKind ?? 'release-gate:verify');
			if (resource.kind === 'save-gate') return String(resource.spec.gateKind ?? 'save-gate:promotion-readiness');
			return resource.kind;
		})();
		return {
			unitId: resource.id,
			unitType: unitType as TreeseedDesiredUnit['unitType'],
			provider: resource.provider,
			identity,
			target: { kind: 'persistent', scope: graph.environment },
			logicalName: resource.logicalName,
			dependencies: resource.dependencies,
			spec: resource.spec,
			secrets: {},
			metadata: {
				resourceKind: resource.kind,
				packageId: resource.packageId,
				serviceId: resource.serviceId,
				source: resource.source,
			},
		};
	}
	const spec = resource.spec;
	const unitType = typeof spec.unitType === 'string' ? spec.unitType : null;
	const resourceIdentity = spec.identity && typeof spec.identity === 'object' ? spec.identity : null;
	const target = spec.target && typeof spec.target === 'object' ? spec.target : { kind: 'persistent', scope: graph.environment };
	const unitSpec = spec.spec && typeof spec.spec === 'object' ? spec.spec : {};
	const metadata = spec.metadata && typeof spec.metadata === 'object' ? spec.metadata : {};
	if (!unitType || !resourceIdentity) return null;
	return {
		unitId: resource.source.id,
		unitType: unitType as TreeseedDesiredUnit['unitType'],
		provider: resource.provider,
		identity: resourceIdentity as TreeseedDesiredUnit['identity'],
		target: target as TreeseedReconcileTarget,
		logicalName: resource.logicalName,
		dependencies: resource.dependencies,
		spec: unitSpec as Record<string, unknown>,
		secrets: {},
		metadata: metadata as Record<string, unknown>,
	};
}

export function compileTreeseedDesiredUnitsFromGraph(
	graph: TreeseedDesiredResourceGraph,
	selector?: TreeseedReconcileSelector,
): TreeseedDesiredUnit[] {
	return selectTreeseedDesiredResources(graph, selector).resources
		.map((resource) => convertDesiredResourceToReconcileUnit(graph, resource))
		.filter((unit): unit is TreeseedDesiredUnit => Boolean(unit));
}
