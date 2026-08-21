import { SdkDispatchExecutionClass,SdkDispatchNamespace,SdkDispatchPolicy,SdkDispatchTarget,TreeDxDeploymentProvider,TreeDxInstanceKind,TreeDxInstanceStatus,TreeDxMirrorDirection,TreeDxMirrorStatus,TreeDxShareScope,TreeDxShareStatus } from './sdk-model-names.ts';

export interface TreeDxInstance {
	id: string;
	teamId: string;
	kind: TreeDxInstanceKind;
	provider: TreeDxDeploymentProvider | (string & {});
	name: string;
	baseUrl?: string | null;
	registryUrl?: string | null;
	publicRead: boolean;
	primary: boolean;
	status: TreeDxInstanceStatus;
	imageRef?: string | null;
	railwayProjectId?: string | null;
	railwayServiceId?: string | null;
	railwayEnvironmentId?: string | null;
	volumeMountPath?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface TreeDxDeployment {
	id: string;
	teamId: string;
	instanceId?: string | null;
	provider: TreeDxDeploymentProvider | (string & {});
	status: string;
	imageRef?: string | null;
	volumeMountPath?: string | null;
	serviceRefs?: Record<string, unknown>;
	result?: Record<string, unknown>;
	error?: Record<string, unknown> | null;
	createdAt?: string;
	updatedAt?: string;
	completedAt?: string | null;
}

export interface TreeDxDeploymentRequest {
	teamId: string;
	instanceId?: string | null;
	deploymentId?: string | null;
	provider?: TreeDxDeploymentProvider | (string & {});
	imageRef?: string | null;
	volumeMountPath?: string | null;
	publicRead?: boolean;
	baseUrl?: string | null;
	planOnly?: boolean;
}

export interface TreeDxDeploymentResult {
	ok: boolean;
	teamId: string;
	instanceId: string;
	deploymentId: string;
	provider: TreeDxDeploymentProvider | (string & {});
	status: string;
	baseUrl?: string | null;
	imageRef?: string | null;
	volumeMountPath?: string | null;
	serviceRefs?: Record<string, unknown>;
	health?: Record<string, unknown> | string | null;
	error?: Record<string, unknown> | null;
}

export interface TreeDxMirror {
	id: string;
	teamId: string;
	instanceId: string;
	name: string;
	direction: TreeDxMirrorDirection;
	targetKind: string;
	targetUrl?: string | null;
	status: TreeDxMirrorStatus;
	instructions?: string | null;
	lastSyncAt?: string | null;
	lastSyncStatus?: string | null;
	lastSyncMetadata?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface TreeDxShareLink {
	id: string;
	teamId: string;
	instanceId?: string | null;
	projectId?: string | null;
	libraryId?: string | null;
	scope: TreeDxShareScope;
	targetTeamId?: string | null;
	trustGrant?: Record<string, unknown>;
	publicRead: boolean;
	status: TreeDxShareStatus;
	expiresAt?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
	revokedAt?: string | null;
}

export interface TreeDxProjectLibraryBinding {
	id: string;
	teamId: string;
	projectId: string;
	instanceId: string;
	libraryId: string;
	repositoryId?: string | null;
	contentPath: string;
	contentRepositoryUrl?: string | null;
	contentRepositoryDefaultBranch?: string | null;
	contentRepositoryRef?: string | null;
	r2BucketName?: string | null;
	r2ManifestKey?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface ProjectContentRepositoryTopology {
	accessMode: 'treedx';
	githubUrl?: string | null;
	defaultBranch?: string | null;
	ref?: string | null;
	contentPath: string;
	treeDx: {
		instanceId: string;
		libraryId: string;
		repositoryId?: string | null;
		baseUrl?: string | null;
	};
	remote?: {
		bindingId: string;
		serviceConnectionId: string;
		capabilityBindingId: string;
		providerId: string;
		providerRepositoryId: string;
		owner: string;
		name: string;
		cloneUrl: string;
		defaultRef: string;
		publicationRef: string;
		authorityId: string;
		expectedHead?: string | null;
		observedHead?: string | null;
		grantStatus: 'ready' | 'missing' | 'suspended' | 'reauthorization-required';
		drift: 'none' | 'remote-ahead' | 'remote-behind' | 'diverged' | 'unavailable' | 'unknown';
		version: number;
	} | null;
	r2?: {
		bucketName?: string | null;
		manifestKey?: string | null;
		publicBaseUrl?: string | null;
	};
}

export interface ProjectFilesystemRepositoryTopology {
	accessMode: 'filesystem';
	provider?: string | null;
	owner?: string | null;
	name?: string | null;
	url?: string | null;
	defaultBranch?: string | null;
	ref?: string | null;
	checkoutPath?: string | null;
	volumePath?: string | null;
	submoduleMountPath?: string | null;
	siteSubmodulePath?: string | null;
}

export interface ProjectRepositoryTopology {
	contentRepository: ProjectContentRepositoryTopology;
	siteRepository: ProjectFilesystemRepositoryTopology;
	projectRepository?: ProjectFilesystemRepositoryTopology | null;
}

export interface SdkDispatchCapability {
	namespace: SdkDispatchNamespace;
	operation: string;
	executionClass: SdkDispatchExecutionClass;
	allowedTargets: SdkDispatchTarget[];
	defaultTarget: SdkDispatchTarget;
	defaultDispatchMode: SdkDispatchPolicy;
	summary?: string;
}

export const PUBLICATION_ACCESS_MODES = [
	'free',
	'private',
	'contact',
	'one_time',
	'one_time_current_version',
	'subscription',
	'subscription_updates',
	'professional_hosting',
	'scoped_contract',
	'external',
] as const;

export type PublicationAccessMode = typeof PUBLICATION_ACCESS_MODES[number];
export type CatalogItemOfferMode = PublicationAccessMode;
