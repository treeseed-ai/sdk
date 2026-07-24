import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
	discoverPackageAdapters,
	type PackageAdapter,
} from '../../operations/services/reconciliation/package-adapters.ts';
import { redactCapacityProviderEnv, validateAndDigestCapacityProviderManifest } from '../../capacity/providers/capacity-provider.ts';
import { workspaceRoot } from '../../operations/services/treedx/workspaces/workspace-tools.ts';
import {
	checkedOutTemplateRepositories,
	type TemplateRepositoryManifest,
} from '../../operations/services/support/managed-repositories.ts';
import { deriveDesiredUnits } from '../../reconcile/reconciliation/desired-state.ts';
import type { DesiredUnit, ReconcileSelector, ReconcileTarget } from '../../reconcile/support/contracts/contracts.ts';
import {
	buildProjectLocalContentResources,
	type LocalContentMode,
} from '../content/local-content-materialization.ts';
import { localTreeDxSeedDigest } from '../treedx/repositories/local-treedx-seed.ts';
import { INTERNAL_PACKAGE_DEPENDENCY_FIELDS, DesiredEnvironment, DesiredResource, DesiredResourceKind, PackageUnit, TemplateUnit, stringRecord } from './desired-environment.ts';

export function safeTreeDxRepositoryName(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_.-]+/gu, '-')
		.replace(/^-+|-+$/gu, '') || 'project';
}

export function localTreeDxContentProjects(tenantRoot: string) {
	const seedPath = resolvePath(tenantRoot, 'seeds', 'treeseed.yaml');
	if (!existsSync(seedPath)) return [];
	const parsed = parseYaml(readFileSync(seedPath, 'utf8')) as unknown;
	const resources = stringRecord((parsed as Record<string, unknown> | null)?.resources);
	const projects = Array.isArray(resources.projects) ? resources.projects : [];
	return projects.flatMap((entry) => {
		const project = stringRecord(entry);
		const slug = typeof project.slug === 'string' && project.slug.trim() ? project.slug.trim() : '';
		const repository = stringRecord(project.repository);
		const architecture = stringRecord(project.architecture);
		const contentPath = typeof architecture.contentPath === 'string' && architecture.contentPath.trim()
			? architecture.contentPath.trim()
			: null;
		if (!slug || !contentPath) return [];
		const checkoutPath = typeof repository.checkoutPath === 'string' && repository.checkoutPath.trim()
			? repository.checkoutPath.trim()
			: '.';
		const seedPaths = [
			`${contentPath.replace(/\/+$/u, '')}/objectives`,
			`${contentPath.replace(/\/+$/u, '')}/agents`,
		];
		const localRoot = checkoutPath === '.' ? tenantRoot : resolvePath(tenantRoot, checkoutPath);
		return [{
			projectKey: typeof project.key === 'string' ? project.key : `project:treeseed/${slug}`,
			slug,
			repositoryName: safeTreeDxRepositoryName(`treeseed-${slug}`),
			repositoryId: safeTreeDxRepositoryName(`treeseed-${slug}`),
			localRoot,
			contentPath,
			defaultRef: 'refs/heads/main',
			seedPaths,
			seedDigest: localTreeDxSeedDigest({ localRoot, contentPath, seedPaths }),
		}];
	});
}

export function localTreeDxTemplateContentProjects(tenantRoot: string, templates: TemplateUnit[]) {
	return templates.flatMap((template) => {
		const localRoot = resolvePath(tenantRoot, template.path);
		const contentPath = 'template/src/content';
		if (!existsSync(resolvePath(localRoot, contentPath))) return [];
		const slug = `starter-${safeTreeDxRepositoryName(template.id)}`;
		return [{
			projectKey: `template:${template.id}`,
			slug,
			repositoryName: safeTreeDxRepositoryName(`treeseed-${slug}`),
			repositoryId: safeTreeDxRepositoryName(`treeseed-${slug}`),
			localRoot,
			contentPath,
			defaultRef: 'refs/heads/main',
			seedPaths: [contentPath],
			seedDigest: localTreeDxSeedDigest({ localRoot, contentPath, seedPaths: [contentPath] }),
		}];
	});
}

export function releasePhaseForEnvironment(environment: DesiredEnvironment) {
	return environment === 'prod' ? 'release' : 'stage';
}

export function internalPackageDependencies(packages: PackageUnit[], pkg: PackageUnit) {
	const packageIds = new Set(packages.map((entry) => entry.id));
	const packageJsonPath = resolvePath(pkg.path, 'package.json');
	if (!existsSync(packageJsonPath)) return [];
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
		const dependencies = new Set<string>();
		for (const field of INTERNAL_PACKAGE_DEPENDENCY_FIELDS) {
			const entries = packageJson[field];
			if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
			for (const dependencyName of Object.keys(entries)) {
				if (dependencyName !== pkg.id && packageIds.has(dependencyName)) {
					dependencies.add(dependencyName);
				}
			}
		}
		return [...dependencies].sort();
	} catch {
		return [];
	}
}

export function resourceKindForUnit(unit: DesiredUnit): DesiredResourceKind {
	if (unit.provider === 'railway') {
		if (unit.unitType.startsWith('railway-service:')) return 'railway-service';
		if (unit.unitType === 'custom-domain:api') return 'railway-domain';
	}
	if (unit.provider === 'cloudflare' || unit.provider === 'cloudflare-dns') return 'cloudflare-resource';
	if (unit.provider === 'treeseed' && /runtime$/u.test(unit.unitType)) return 'release-gate';
	return 'cloudflare-resource';
}

export function serviceIdForUnit(unit: DesiredUnit) {
	const serviceKey = unit.metadata.serviceKey;
	if (typeof serviceKey === 'string' && serviceKey.trim()) return serviceKey;
	if (unit.unitType.startsWith('railway-service:')) return unit.unitType.slice('railway-service:'.length);
	return null;
}

export function packageIdForUnit(unit: DesiredUnit) {
	const app = unit.metadata.applicationId ?? unit.metadata.packageId;
	return typeof app === 'string' && app.trim() ? app : null;
}

export function resourceFromUnit(unit: DesiredUnit, environment: DesiredEnvironment): DesiredResource {
	return {
		id: unit.unitId,
		kind: resourceKindForUnit(unit),
		provider: unit.provider,
		environment,
		packageId: packageIdForUnit(unit),
		serviceId: serviceIdForUnit(unit),
		logicalName: unit.logicalName,
		dependencies: unit.dependencies,
		spec: {
			unitType: unit.unitType,
			identity: unit.identity,
			target: unit.target,
			spec: unit.spec,
			secrets: Object.keys(unit.secrets),
			metadata: unit.metadata,
		},
		source: {
			type: 'reconcile-unit',
			id: unit.unitId,
		},
	};
}
