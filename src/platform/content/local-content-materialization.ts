import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { loadAndPlanSeed } from '../../seeds/index.ts';
import type {
	SeedContentRuntimeSource,
	SeedLocalContentMaterialization,
	SeedProjectArchitecture,
	SeedProjectRepository,
	SeedProjectTopology,
} from '../../seeds/types.ts';
import type { DesiredEnvironment, DesiredResource } from '../reconciliation/desired-state.ts';

export const LOCAL_CONTENT_MODES = ['auto', 'none', 'preview', 'edit'] as const;

export type LocalContentMode = typeof LOCAL_CONTENT_MODES[number];

export type LocalContentMaterializationStatus =
	| 'not_requested'
	| 'existing_path_ready'
	| 'existing_path_missing'
	| 'managed_clone_ready'
	| 'managed_clone_missing'
	| 'submodule_ready'
	| 'submodule_missing'
	| 'site_not_prepared'
	| 'blocked';

type ProjectPayload = {
	teamKey?: unknown;
	slug?: unknown;
	name?: unknown;
	repository?: unknown;
	architecture?: unknown;
};

type HubRepositoryPayload = {
	projectKey?: unknown;
	role?: unknown;
	provider?: unknown;
	owner?: unknown;
	name?: unknown;
	gitUrl?: unknown;
	defaultBranch?: unknown;
	currentBranch?: unknown;
	submodulePath?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = '') {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function safeSegment(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		|| 'project';
}

function normalizeRelativePath(value: unknown, fallback = '.') {
	const raw = stringValue(value, fallback).replace(/\\/gu, '/').replace(/^\/+/u, '');
	const parts = raw.split('/').filter((part) => part && part !== '.');
	if (parts.some((part) => part === '..')) {
		return fallback;
	}
	return parts.length === 0 ? '.' : parts.join('/');
}

function pathFrom(root: string, ...parts: Array<string | null | undefined>) {
	const clean = parts.filter((part): part is string => Boolean(part && part !== '.'));
	return resolve(root, ...clean);
}

function isPreparedSitePath(path: string) {
	if (!existsSync(path)) return false;
	const stat = statSync(path);
	if (!stat.isDirectory()) return false;
	return [
		'treeseed.site.yaml',
		'astro.config.ts',
		'astro.config.ts',
		'package.json',
		'src',
	].some((entry) => existsSync(resolve(path, entry)));
}

function contentSourceMode(source: SeedContentRuntimeSource) {
	if (source === 'local_directory') return 'local_directory';
	if (source === 'treedx_snapshot') return 'treedx';
	return 'r2';
}

function projectRepository(value: unknown): SeedProjectRepository | null {
	if (!isRecord(value)) return null;
	const provider = stringValue(value.provider);
	const owner = stringValue(value.owner);
	const name = stringValue(value.name);
	const gitUrl = stringValue(value.gitUrl);
	const role = stringValue(value.role, 'software');
	if (!provider || !owner || !name || !gitUrl) return null;
	return {
		role,
		provider,
		owner,
		name,
		gitUrl,
		defaultBranch: stringValue(value.defaultBranch, 'main'),
		checkoutPath: stringValue(value.checkoutPath) || undefined,
		submodulePath: stringValue(value.submodulePath) || undefined,
		webUrl: stringValue(value.webUrl) || undefined,
	};
}

function projectArchitecture(value: unknown): SeedProjectArchitecture | null {
	if (!isRecord(value)) return null;
	const topology = stringValue(value.topology) as SeedProjectTopology;
	const contentRuntimeSource = stringValue(value.contentRuntimeSource) as SeedContentRuntimeSource;
	const localContentMaterialization = stringValue(value.localContentMaterialization) as SeedLocalContentMaterialization;
	if (!topology || !contentRuntimeSource || !localContentMaterialization) return null;
	return {
		topology,
		rootPath: normalizeRelativePath(value.rootPath),
		sitePath: normalizeRelativePath(value.sitePath),
		contentPath: stringValue(value.contentPath) ? normalizeRelativePath(value.contentPath) : undefined,
		contentRuntimeSource,
		localContentMaterialization,
		contentPublishTarget: isRecord(value.contentPublishTarget) ? value.contentPublishTarget as SeedProjectArchitecture['contentPublishTarget'] : undefined,
		requiresLocalContentForCi: value.requiresLocalContentForCi === true,
		requiresLocalContentForDeploy: value.requiresLocalContentForDeploy === true,
	};
}

function hubRepository(value: unknown): (SeedProjectRepository & { projectKey: string }) | null {
	if (!isRecord(value)) return null;
	const payload = value as HubRepositoryPayload;
	const projectKey = stringValue(payload.projectKey);
	const role = stringValue(payload.role);
	const provider = stringValue(payload.provider);
	const owner = stringValue(payload.owner);
	const name = stringValue(payload.name);
	const gitUrl = stringValue(payload.gitUrl);
	if (!projectKey || role !== 'content' || !provider || !owner || !name || !gitUrl) return null;
	return {
		projectKey,
		role,
		provider,
		owner,
		name,
		gitUrl,
		defaultBranch: stringValue(payload.defaultBranch) || stringValue(payload.currentBranch) || 'main',
		submodulePath: stringValue(payload.submodulePath) || undefined,
	};
}

function requestedMaterialization(architecture: SeedProjectArchitecture, mode: LocalContentMode): SeedLocalContentMaterialization {
	if (mode === 'none') return 'none';
	if (mode === 'preview' || mode === 'edit') {
		if (architecture.localContentMaterialization === 'none' && architecture.contentRuntimeSource !== 'local_directory') {
			return 'managed_clone';
		}
		return architecture.localContentMaterialization === 'none' ? 'managed_clone' : architecture.localContentMaterialization;
	}
	return architecture.localContentMaterialization;
}

export function buildProjectLocalContentResources({
	tenantRoot,
	environment,
	localContent = 'auto',
}: {
	tenantRoot: string;
	environment: DesiredEnvironment;
	localContent?: LocalContentMode;
}): DesiredResource[] {
	if (environment !== 'local') return [];
	const seed = loadAndPlanSeed({
		projectRoot: tenantRoot,
		seedName: 'treeseed',
		environments: 'local',
		mode: 'plan',
	});
	if (!seed.ok || !seed.plan) return [];
	const contentRepositories = new Map<string, SeedProjectRepository>();
	for (const action of seed.plan.actions) {
		if (action.kind !== 'hubRepository') continue;
		const repo = hubRepository(action.payload);
		if (repo) contentRepositories.set(repo.projectKey, repo);
	}
	return seed.plan.actions.flatMap((action) => {
		if (action.kind !== 'project') return [];
		const payload = action.payload as ProjectPayload;
		const architecture = projectArchitecture(payload.architecture);
		const repository = projectRepository(payload.repository);
		const slug = stringValue(payload.slug, safeSegment(action.key));
		const teamSlug = stringValue(payload.teamKey, 'team:treeseed').replace(/^team:/u, '') || 'treeseed';
		if (!architecture || !repository) return [];
		const contentRepository = contentRepositories.get(action.key) ?? repository;
		const materialization = requestedMaterialization(architecture, localContent);
		const rootPath = normalizeRelativePath(architecture.rootPath);
		const sitePath = normalizeRelativePath(architecture.sitePath);
		const contentPath = architecture.contentPath ? normalizeRelativePath(architecture.contentPath) : null;
		const repositoryCheckoutPath = normalizeRelativePath(repository.checkoutPath, '.');
		const sourceRepoSlug = `${contentRepository.owner}/${contentRepository.name}`;
		const managedTarget = pathFrom(tenantRoot, '.treeseed', 'local-content', safeSegment(teamSlug), safeSegment(slug), 'content');
		const existingRoot = pathFrom(tenantRoot, repositoryCheckoutPath, rootPath);
		const effectiveLocalPath = materialization === 'managed_clone'
			? managedTarget
			: materialization === 'submodule'
				? pathFrom(tenantRoot, repositoryCheckoutPath, normalizeRelativePath(contentRepository.submodulePath ?? repository.submodulePath ?? contentPath ?? sitePath))
				: materialization === 'existing_path'
					? pathFrom(existingRoot, contentPath ?? sitePath)
					: null;
		const siteLocalPath = materialization === 'managed_clone'
			? pathFrom(managedTarget, sitePath)
			: pathFrom(existingRoot, sitePath);
		const siteReady = isPreparedSitePath(siteLocalPath);
		const exists = effectiveLocalPath ? existsSync(effectiveLocalPath) : false;
		const materializationStatus: LocalContentMaterializationStatus = materialization === 'none'
			? 'not_requested'
			: materialization === 'existing_path'
				? exists ? siteReady ? 'existing_path_ready' : 'site_not_prepared' : 'existing_path_missing'
				: materialization === 'managed_clone'
					? exists ? siteReady ? 'managed_clone_ready' : 'site_not_prepared' : 'managed_clone_missing'
					: exists ? siteReady ? 'submodule_ready' : 'site_not_prepared' : 'submodule_missing';
		const executeRequested = (localContent === 'preview' || localContent === 'edit')
			&& (materialization === 'managed_clone' || materialization === 'submodule');
		return [{
			id: `local-content-materialization:${safeSegment(teamSlug)}:${safeSegment(slug)}:content`,
			kind: 'local-content-materialization' as const,
			provider: 'local',
			environment,
			packageId: '@treeseed/market',
			serviceId: `content:${slug}`,
			logicalName: `${stringValue(payload.name, slug)} local content materialization`,
			dependencies: architecture.contentRuntimeSource === 'treedx_snapshot' && !executeRequested ? ['local-treedx:team-primary'] : [],
			spec: {
				teamKey: stringValue(payload.teamKey, 'team:treeseed'),
				teamSlug,
				projectKey: action.key,
				projectSlug: slug,
				projectName: stringValue(payload.name, slug),
				topology: architecture.topology,
				rootPath,
				sitePath,
				contentPath,
				contentRuntimeSource: architecture.contentRuntimeSource,
				contentSourceMode: contentSourceMode(architecture.contentRuntimeSource),
				localContentMaterialization: materialization,
				configuredLocalContentMaterialization: architecture.localContentMaterialization,
				requestedLocalContentMode: localContent,
				executeRequested,
				repository: {
					provider: repository.provider,
					owner: repository.owner,
					name: repository.name,
					gitUrl: repository.gitUrl,
					defaultBranch: repository.defaultBranch ?? 'main',
					checkoutPath: repository.checkoutPath ?? null,
					submodulePath: repository.submodulePath ?? null,
				},
				contentRepository: {
					provider: contentRepository.provider,
					owner: contentRepository.owner,
					name: contentRepository.name,
					gitUrl: contentRepository.gitUrl,
					defaultBranch: contentRepository.defaultBranch ?? repository.defaultBranch ?? 'main',
					submodulePath: contentRepository.submodulePath ?? null,
				},
				sourceRepoSlug,
				effectiveLocalPath,
				siteLocalPath,
				docsSiteReadiness: siteReady ? 'ready' : 'site_not_prepared',
				materializationStatus,
				targetRelativePath: effectiveLocalPath ? effectiveLocalPath.replace(`${tenantRoot}/`, '') : null,
				managedCloneRoot: resolve(tenantRoot, '.treeseed', 'local-content'),
				defaultDirectoryName: basename(effectiveLocalPath ?? slug),
			},
			source: { type: 'package-adapter' as const, id: `project-architecture:${action.key}` },
		} satisfies DesiredResource];
	});
}
