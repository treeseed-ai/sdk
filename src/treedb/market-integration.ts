import type {
	ProjectContentRepositoryTopology,
	ProjectFilesystemRepositoryTopology,
	ProjectRepositoryTopology,
	TreeDbInstance,
	TreeDbProjectLibraryBinding,
} from '../sdk-types.ts';

export const TREE_DB_DOCKER_IMAGE = 'treeseed/treedb:latest' as const;
export const TREE_DB_VOLUME_MOUNT_PATH = '/data' as const;
export const TREE_DB_CONTENT_PATH = 'src/content' as const;

function cleanString(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function safeSlug(value: unknown, fallback = 'library') {
	return String(value ?? fallback)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_.-]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		|| fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function defaultTreeDbImageRef(tag = 'latest') {
	const normalizedTag = cleanString(tag) ?? 'latest';
	return normalizedTag.includes('/') || normalizedTag.includes(':')
		? normalizedTag
		: `treeseed/treedb:${normalizedTag}`;
}

export function treeDbLibraryIdForProject(input: { teamSlug?: string | null; projectSlug?: string | null; projectId?: string | null }) {
	return [input.teamSlug, input.projectSlug ?? input.projectId]
		.map((part) => safeSlug(part, 'project'))
		.join('/');
}

export function buildManagedTreeDbInstance(input: {
	id: string;
	teamId: string;
	teamSlug?: string | null;
	visibility?: 'private' | 'public' | string | null;
	imageRef?: string | null;
	baseUrl?: string | null;
	now?: string;
}): TreeDbInstance {
	const isPublic = input.visibility === 'public';
	const now = input.now ?? new Date().toISOString();
	return {
		id: input.id,
		teamId: input.teamId,
		kind: isPublic ? 'managed_public_federation' : 'managed_private',
		provider: isPublic ? 'public_federation' : 'railway',
		name: isPublic ? 'TreeSeed public federation' : `${safeSlug(input.teamSlug ?? input.teamId, 'team')} TreeDB`,
		baseUrl: cleanString(input.baseUrl),
		registryUrl: cleanString(input.baseUrl),
		publicRead: isPublic,
		primary: true,
		status: cleanString(input.baseUrl) ? 'active' : 'pending',
		imageRef: input.imageRef ?? defaultTreeDbImageRef(),
		volumeMountPath: isPublic ? null : TREE_DB_VOLUME_MOUNT_PATH,
		metadata: {
			hostRole: 'knowledge-library',
			contentCanonical: 'treedb',
			managedBy: 'treeseed-market',
		},
		createdAt: now,
		updatedAt: now,
	};
}

export function buildProjectRepositoryTopology(input: {
	instance: Pick<TreeDbInstance, 'id' | 'baseUrl'>;
	binding: Pick<TreeDbProjectLibraryBinding, 'libraryId' | 'repositoryId' | 'contentPath' | 'contentRepositoryUrl' | 'contentRepositoryDefaultBranch' | 'contentRepositoryRef' | 'r2BucketName' | 'r2ManifestKey'>;
	siteRepository: Partial<ProjectFilesystemRepositoryTopology>;
	projectRepository?: Partial<ProjectFilesystemRepositoryTopology> | null;
}): ProjectRepositoryTopology {
	const siteRepository = normalizeFilesystemRepository(input.siteRepository, 'site');
	return {
		contentRepository: {
			accessMode: 'treedb',
			githubUrl: input.binding.contentRepositoryUrl ?? null,
			defaultBranch: input.binding.contentRepositoryDefaultBranch ?? null,
			ref: input.binding.contentRepositoryRef ?? null,
			contentPath: input.binding.contentPath || TREE_DB_CONTENT_PATH,
			treeDb: {
				instanceId: input.instance.id,
				libraryId: input.binding.libraryId,
				repositoryId: input.binding.repositoryId ?? null,
				baseUrl: input.instance.baseUrl ?? null,
			},
			r2: {
				bucketName: input.binding.r2BucketName ?? null,
				manifestKey: input.binding.r2ManifestKey ?? null,
			},
		},
		siteRepository,
		projectRepository: input.projectRepository ? normalizeFilesystemRepository(input.projectRepository, 'project') : null,
	};
}

export function normalizeProjectRepositoryTopology(value: unknown): ProjectRepositoryTopology {
	const record = objectValue(value);
	const content = objectValue(record.contentRepository);
	const treeDb = objectValue(content.treeDb);
	const site = normalizeFilesystemRepository(record.siteRepository, 'site');
	const project = record.projectRepository ? normalizeFilesystemRepository(record.projectRepository, 'project') : null;
	const instanceId = cleanString(treeDb.instanceId);
	const libraryId = cleanString(treeDb.libraryId);
	if (!instanceId || !libraryId) {
		throw new Error('Project repository topology contentRepository.treeDb.instanceId and libraryId are required.');
	}
	if (site.accessMode !== 'filesystem') {
		throw new Error('Project repository topology siteRepository must use filesystem access.');
	}
	return {
		contentRepository: {
			accessMode: 'treedb',
			githubUrl: cleanString(content.githubUrl),
			defaultBranch: cleanString(content.defaultBranch),
			ref: cleanString(content.ref),
			contentPath: cleanString(content.contentPath) ?? TREE_DB_CONTENT_PATH,
			treeDb: {
				instanceId,
				libraryId,
				repositoryId: cleanString(treeDb.repositoryId),
				baseUrl: cleanString(treeDb.baseUrl),
			},
			r2: objectValue(content.r2),
		} as ProjectContentRepositoryTopology,
		siteRepository: site,
		projectRepository: project,
	};
}

function normalizeFilesystemRepository(value: unknown, fallbackName: string): ProjectFilesystemRepositoryTopology {
	const record = objectValue(value);
	return {
		accessMode: 'filesystem',
		provider: cleanString(record.provider) ?? 'github',
		owner: cleanString(record.owner),
		name: cleanString(record.name) ?? fallbackName,
		url: cleanString(record.url),
		defaultBranch: cleanString(record.defaultBranch) ?? cleanString(record.ref) ?? 'staging',
		ref: cleanString(record.ref),
		checkoutPath: cleanString(record.checkoutPath),
		volumePath: cleanString(record.volumePath),
		submoduleMountPath: cleanString(record.submoduleMountPath),
		siteSubmodulePath: cleanString(record.siteSubmodulePath),
	};
}

export function isTreeDbCanonicalContent(topology: ProjectRepositoryTopology | null | undefined) {
	return topology?.contentRepository?.accessMode === 'treedb'
		&& Boolean(topology.contentRepository.treeDb?.instanceId)
		&& Boolean(topology.contentRepository.treeDb?.libraryId);
}
