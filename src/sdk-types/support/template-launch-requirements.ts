import type { FieldAliasBinding } from '../../entrypoints/models/field-aliases.ts';
import type {
	CapacityBusinessModel,
	CapacityLaneUnit,
	CapacityReservation,
	NativeUsageObservation,
} from '../../agent-capacity/contracts/support/financial-records.ts';
import type {
	CapacityExecutionProvider,
	CapacityExecutionProviderNativeLimit,
	CapacityExecutionProviderObservation,
	CapacityProviderMembershipView,
} from '../../capacity-provider/contracts/index.ts';
import { ProjectConnectionMode, ProjectEnvironmentName, ProjectExecutionOwner, ProjectLaunchRequirementKind, ProjectRunnerRegistrationState, SdkDispatchExecutionClass, SdkDispatchNamespace, SdkDispatchPolicy, SdkDispatchTarget, TemplateHostRequirement, TemplateResourceRequirement, TemplateSecretRequirement, TreeDxDeploymentProvider, TreeDxInstanceKind, TreeDxInstanceStatus, TreeDxMirrorDirection, TreeDxMirrorStatus, TreeDxShareScope, TreeDxShareStatus, HostingKind, HostingRegistration } from './sdk-model-names.ts';

export interface TemplateLaunchRequirements {
	version?: number;
	hosts?: TemplateHostRequirement[];
	resources?: TemplateResourceRequirement[];
	secrets?: TemplateSecretRequirement[];
}

export interface ProjectLaunchHostBindingInput {
	requirementKey: string;
	requirementKind: ProjectLaunchRequirementKind;
	type: string;
	provider: string;
	hostId?: string | null;
	managedHostKey?: string | null;
	mode?: string | null;
	displayName?: string;
	environmentScopes?: ProjectEnvironmentName[];
	configValues?: Record<string, unknown>;
	environmentValues?: Record<string, string>;
	secretRefs?: Record<string, string>;
	selectedBy?: 'user' | 'team-default' | 'managed-default' | 'template-default';
}

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

export function projectConnectionModeFromHosting(
	kind: HostingKind,
	registration: HostingRegistration = 'none',
): ProjectConnectionMode {
	if (kind === 'hosted_project') {
		return 'hosted';
	}
	if (kind === 'self_hosted_project') {
		return registration === 'optional' ? 'hybrid' : 'self_hosted';
	}
	return 'hosted';
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

export interface ProjectConnection {
	id: string;
	projectId: string;
	mode: ProjectConnectionMode;
	projectApiBaseUrl: string | null;
	runnerRegistrationState: ProjectRunnerRegistrationState;
	executionOwner: ProjectExecutionOwner;
	runnerRegisteredAt: string | null;
	runnerLastSeenAt: string | null;
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
}

export const COMMERCE_PRODUCT_KINDS = [
	'template',
	'knowledge_pack',
	'ui_library',
	'admin_interface',
	'api_platform',
	'hosted_project',
	'professional_hosting',
	'scoped_service',
	'capacity_listing',
] as const;

export type CommerceProductKind = typeof COMMERCE_PRODUCT_KINDS[number];

export const COMMERCE_OFFER_MODES = [
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

export type CommerceOfferMode = typeof COMMERCE_OFFER_MODES[number];

export type CatalogItemOfferMode = CommerceOfferMode;

export const COMMERCE_VENDOR_TRUST_LEVELS = [
	'public_publisher',
	'verified_seller',
	'trusted_service_vendor',
	'trusted_capacity_vendor',
	'integration_partner',
] as const;

export type CommerceVendorTrustLevel = typeof COMMERCE_VENDOR_TRUST_LEVELS[number];
