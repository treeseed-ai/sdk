import { existsSync,readFileSync,readdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { normalizeRepositoryName,projectRepositoryName } from '../../treedx/accounts/repository-name.ts';
import type { DesiredUnit } from '../../reconcile/support/contracts/contracts.ts';
import { localTreeDxSeedDigest } from '../treedx/repositories/local-treedx-seed.ts';
import { DesiredEnvironment,DesiredResource,DesiredResourceKind,INTERNAL_PACKAGE_DEPENDENCY_FIELDS,PackageUnit,stringRecord } from './desired-environment.ts';

export function safeTreeDxRepositoryName(value: string) {
	return normalizeRepositoryName(value);
}

function projectContentPath(architecture: Record<string, unknown>) {
	const explicit = typeof architecture.contentPath === 'string' ? architecture.contentPath.trim() : '';
	if (explicit) return explicit.replace(/^\.\//u, '').replace(/\/+$/u, '');
	const sitePath = typeof architecture.sitePath === 'string' && architecture.sitePath.trim()
		? architecture.sitePath.trim().replace(/^\.\//u, '').replace(/\/+$/u, '')
		: '.';
	return sitePath === '.' ? 'src/content' : `${sitePath}/src/content`;
}

function persistedSeedNames(tenantRoot: string) {
	const statePath = resolvePath(tenantRoot, '.treeseed', 'run', 'state.json');
	if (!existsSync(statePath)) return [];
	try {
		const state = stringRecord(JSON.parse(readFileSync(statePath, 'utf8')));
		return Array.isArray(state.seeds) ? state.seeds.map(String).filter(Boolean) : [];
	} catch {
		return [];
	}
}

function selectedSeedResources(tenantRoot: string, selectedSeedNames?: string[]) {
	const selected = selectedSeedNames?.length ? selectedSeedNames : persistedSeedNames(tenantRoot);
	const names = selected.length ? selected : ['treeseed'];
	return names.flatMap((seedName) => {
		const seedPath = resolvePath(tenantRoot, 'seeds', `${seedName}.yaml`);
		if (!existsSync(seedPath)) return [];
		const parsed = stringRecord(parseYaml(readFileSync(seedPath, 'utf8')));
		const environments = Array.isArray(parsed.environments) ? parsed.environments.map(String) : ['local'];
		return environments.includes('local') ? [stringRecord(parsed.resources)] : [];
	});
}

function uniqueSeedEntries(entries: unknown[], identity: (entry: Record<string, unknown>) => string) {
	const unique = new Map<string, Record<string, unknown>>();
	for (const entry of entries) {
		const value = stringRecord(entry);
		const key = identity(value);
		if (!key) continue;
		const current = unique.get(key);
		if (current && JSON.stringify(current) !== JSON.stringify(value)) {
			throw new Error(`Selected local seeds declare conflicting TreeDX input ${key}.`);
		}
		unique.set(key, value);
	}
	return [...unique.values()];
}

export function localTreeDxContentProjects(tenantRoot: string, selectedSeedNames?: string[]) {
	const resourceSets = selectedSeedResources(tenantRoot, selectedSeedNames);
	const projects = uniqueSeedEntries(resourceSets.flatMap((resources) => Array.isArray(resources.projects) ? resources.projects : []), (project) => (
		typeof project.key === 'string' && project.key.trim()
			? project.key.trim()
			: `project:treeseed/${String(project.slug ?? '').trim()}`
	));
	const contentRepositories = new Map<string, Record<string, unknown>>();
	const repositoryEntries = uniqueSeedEntries(resourceSets.flatMap((resources) => Array.isArray(resources.hubRepositories) ? resources.hubRepositories : []), (repository) => (
		String(repository.key ?? `${String(repository.project ?? '')}:${String(repository.role ?? '')}`)
	));
	for (const entry of repositoryEntries) {
		const repository = stringRecord(entry);
		const projectKey = typeof repository.project === 'string' ? repository.project.trim() : '';
		if (projectKey && repository.role === 'content') contentRepositories.set(projectKey, repository);
	}
	return projects.flatMap((entry) => {
		const project = stringRecord(entry);
		const projectKey = typeof project.key === 'string' && project.key.trim()
			? project.key.trim()
			: `project:treeseed/${String(project.slug ?? '').trim()}`;
		const slug = typeof project.slug === 'string' && project.slug.trim() ? project.slug.trim() : '';
		const teamKey = typeof project.team === 'string' ? project.team.trim() : '';
		const teamSlug = teamKey.split(/[:/]/u).filter(Boolean).at(-1) ?? '';
		const repository = stringRecord(project.repository);
		const architecture = stringRecord(project.architecture);
		const contentRepository = contentRepositories.get(projectKey);
		const remoteUrl = typeof contentRepository?.gitUrl === 'string' ? contentRepository.gitUrl.trim() : '';
		const remotePolicy = stringRecord(contentRepository?.repositoryPolicy);
		const contentPath = remoteUrl ? 'src/content' : projectContentPath(architecture);
		if (!slug) return [];
		const checkoutPath = typeof repository.checkoutPath === 'string' && repository.checkoutPath.trim()
			? repository.checkoutPath.trim()
			: '.';
		const localRoot = checkoutPath === '.' ? tenantRoot : resolvePath(tenantRoot, checkoutPath);
		const normalizedContentPath = contentPath.replace(/\/+$/u, '');
		const repositoryDocsPath = resolvePath(localRoot, 'docs');
		const repositoryFiles = ['AGENTS.md', 'package.json', ...(existsSync(localRoot) ? readdirSync(localRoot) : []).filter((path) => /^treeseed\..+\.ya?ml$/iu.test(path))]
			.filter((path) => existsSync(resolvePath(localRoot, path)));
		const repositoryGuaranteesPath = resolvePath(localRoot, 'guarantees');
		const signalContractsPath = resolvePath(localRoot, '.treeseed', 'agents', 'signals');
		const proposalTypesPath = resolvePath(localRoot, '.treeseed', 'governance', 'proposal-types');
		const seedPaths = [...(existsSync(repositoryDocsPath)
			? normalizedContentPath === 'docs' || normalizedContentPath.startsWith('docs/') ? ['docs'] : [normalizedContentPath, 'docs']
			: [normalizedContentPath]), ...(existsSync(repositoryGuaranteesPath) ? ['guarantees'] : []),
			...(existsSync(signalContractsPath) ? ['.treeseed/agents/signals'] : []),
			...(existsSync(proposalTypesPath) ? ['.treeseed/governance/proposal-types'] : []), ...repositoryFiles];
		return [{
			projectKey,
			teamSlug,
			slug,
			repositoryName: projectRepositoryName(slug),
			repositoryId: projectRepositoryName(slug),
			localRoot,
			contentPath,
			defaultRef: remoteUrl ? 'refs/heads/staging' : 'refs/heads/main',
			remoteUrl: remoteUrl || undefined,
			remoteOwner: typeof contentRepository?.owner === 'string' ? contentRepository.owner : undefined,
			remoteName: typeof contentRepository?.name === 'string' ? contentRepository.name : undefined,
			remoteVisibility: remotePolicy.visibility === 'private' ? 'private' : 'public',
			sourceBranch: remoteUrl ? 'staging' : undefined,
			seedPaths: remoteUrl ? ['src/content'] : seedPaths,
			seedDigest: remoteUrl ? undefined : localTreeDxSeedDigest({ localRoot, contentPath, seedPaths }),
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
