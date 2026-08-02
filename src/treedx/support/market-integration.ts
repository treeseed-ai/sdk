import type {
ProjectContentRepositoryTopology,
ProjectFilesystemRepositoryTopology,
ProjectRepositoryTopology,
TreeDxInstance,
TreeDxProjectLibraryBinding,
} from '../../entrypoints/models/sdk-types.ts';

export const TREEDX_DOCKER_IMAGE = 'treeseed/treedx:latest' as const;
export const TREEDX_VOLUME_MOUNT_PATH = '/data' as const;
export const TREEDX_CONTENT_PATH = 'src/content' as const;

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

export function defaultTreeDxImageRef(tag = 'latest') {
	const normalizedTag = cleanString(tag) ?? 'latest';
	return normalizedTag.includes('/') || normalizedTag.includes(':')
		? normalizedTag
		: `treeseed/treedx:${normalizedTag}`;
}

export function treeDxLibraryIdForProject(input: { teamSlug?: string | null; projectSlug?: string | null; projectId?: string | null }) {
	return [input.teamSlug, input.projectSlug ?? input.projectId]
		.map((part) => safeSlug(part, 'project'))
		.join('/');
}

export function buildManagedTreeDxInstance(input: {
	id: string;
	teamId: string;
	teamSlug?: string | null;
	visibility?: 'private' | 'public' | string | null;
	imageRef?: string | null;
	baseUrl?: string | null;
	now?: string;
}): TreeDxInstance {
	const isPublic = input.visibility === 'public';
	const now = input.now ?? new Date().toISOString();
	return {
		id: input.id,
		teamId: input.teamId,
		kind: isPublic ? 'managed_public_federation' : 'managed_private',
		provider: isPublic ? 'public_federation' : 'railway',
		name: isPublic ? 'TreeSeed public federation' : `${safeSlug(input.teamSlug ?? input.teamId, 'team')} TreeDX`,
		baseUrl: cleanString(input.baseUrl),
		registryUrl: cleanString(input.baseUrl),
		publicRead: isPublic,
		primary: true,
		status: cleanString(input.baseUrl) ? 'active' : 'pending',
		imageRef: input.imageRef ?? defaultTreeDxImageRef(),
		volumeMountPath: isPublic ? null : TREEDX_VOLUME_MOUNT_PATH,
		metadata: {
			hostRole: 'knowledge-library',
			contentCanonical: 'treedx',
			managedBy: 'treeseed-market',
		},
		createdAt: now,
		updatedAt: now,
	};
}

export function buildProjectRepositoryTopology(input: {
	instance: Pick<TreeDxInstance, 'id' | 'baseUrl'>;
	binding: Pick<TreeDxProjectLibraryBinding, 'libraryId' | 'repositoryId' | 'contentPath' | 'contentRepositoryUrl' | 'contentRepositoryDefaultBranch' | 'contentRepositoryRef' | 'r2BucketName' | 'r2ManifestKey'>;
	siteRepository: Partial<ProjectFilesystemRepositoryTopology>;
	projectRepository?: Partial<ProjectFilesystemRepositoryTopology> | null;
}): ProjectRepositoryTopology {
	const siteRepository = normalizeFilesystemRepository(input.siteRepository, 'site');
	return {
		contentRepository: {
			accessMode: 'treedx',
			githubUrl: input.binding.contentRepositoryUrl ?? null,
			defaultBranch: input.binding.contentRepositoryDefaultBranch ?? null,
			ref: input.binding.contentRepositoryRef ?? null,
			contentPath: input.binding.contentPath || TREEDX_CONTENT_PATH,
			treeDx: {
				instanceId: input.instance.id,
				libraryId: input.binding.libraryId,
				repositoryId: input.binding.repositoryId ?? null,
				baseUrl: input.instance.baseUrl ?? null,
			},
			remote: null,
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
	const treeDx = objectValue(content.treeDx);
	const remote = content.remote ? objectValue(content.remote) : null;
	const site = normalizeFilesystemRepository(record.siteRepository, 'site');
	const project = record.projectRepository ? normalizeFilesystemRepository(record.projectRepository, 'project') : null;
	const instanceId = cleanString(treeDx.instanceId);
	const libraryId = cleanString(treeDx.libraryId);
	if (!instanceId || !libraryId) {
		throw new Error('Project repository topology contentRepository.treeDx.instanceId and libraryId are required.');
	}
	if (site.accessMode !== 'filesystem') {
		throw new Error('Project repository topology siteRepository must use filesystem access.');
	}
	return {
		contentRepository: {
			accessMode: 'treedx',
			githubUrl: cleanString(content.githubUrl),
			defaultBranch: cleanString(content.defaultBranch),
			ref: cleanString(content.ref),
			contentPath: cleanString(content.contentPath) ?? TREEDX_CONTENT_PATH,
			treeDx: {
				instanceId,
				libraryId,
				repositoryId: cleanString(treeDx.repositoryId),
				baseUrl: cleanString(treeDx.baseUrl),
			},
			remote: remote ? normalizeRemoteRepository(remote) : null,
			r2: objectValue(content.r2),
		} as ProjectContentRepositoryTopology,
		siteRepository: site,
		projectRepository: project,
	};
}

function normalizeRemoteRepository(record: Record<string, unknown>): NonNullable<ProjectContentRepositoryTopology['remote']> {
	const required = [
		'bindingId', 'serviceConnectionId', 'capabilityBindingId', 'providerId', 'providerRepositoryId',
		'owner', 'name', 'cloneUrl', 'defaultRef', 'publicationRef', 'authorityId',
	] as const;
	const values = Object.fromEntries(required.map((key) => [key, cleanString(record[key])])) as Record<(typeof required)[number], string | null>;
	const missing = required.filter((key) => !values[key]);
	if (missing.length) throw new Error(`Project remote repository binding is missing: ${missing.join(', ')}.`);
	const version = Number(record.version ?? 1);
	if (!Number.isInteger(version) || version < 1) throw new Error('Project remote repository binding version must be a positive integer.');
	return {
		...(values as Record<(typeof required)[number], string>),
		expectedHead: cleanString(record.expectedHead),
		observedHead: cleanString(record.observedHead),
		grantStatus: ['ready', 'missing', 'suspended', 'reauthorization-required'].includes(String(record.grantStatus))
			? record.grantStatus as NonNullable<ProjectContentRepositoryTopology['remote']>['grantStatus']
			: 'missing',
		drift: ['none', 'remote-ahead', 'remote-behind', 'diverged', 'unavailable', 'unknown'].includes(String(record.drift))
			? record.drift as NonNullable<ProjectContentRepositoryTopology['remote']>['drift']
			: 'unknown',
		version,
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

export function isTreeDxCanonicalContent(topology: ProjectRepositoryTopology | null | undefined) {
	return topology?.contentRepository?.accessMode === 'treedx'
		&& Boolean(topology.contentRepository.treeDx?.instanceId)
		&& Boolean(topology.contentRepository.treeDx?.libraryId);
}
