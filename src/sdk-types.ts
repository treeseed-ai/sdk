import type { TreeseedFieldAliasBinding } from './field-aliases.ts';
import type {
	CapacityBusinessModel,
	CapacityLaneUnit,
	CapacityReservation,
	NativeUsageObservation,
} from './agent-capacity/contracts/financial-records.ts';
import type {
	CapacityExecutionProvider,
	CapacityExecutionProviderNativeLimit,
	CapacityExecutionProviderObservation,
	CapacityProviderMembershipView,
} from './capacity-provider/contracts/index.ts';

export const SDK_MODEL_NAMES = [
	'page',
	'note',
	'question',
	'proposal',
	'decision',
	'book',
	'knowledge',
	'objective',
	'person',
	'subscription',
	'message',
	'agent',
	'agent_run',
	'agent_cursor',
	'content_lease',
	'approval_request',
	'team_inbox_item',
] as const;

export const SDK_OPERATIONS = ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'] as const;
export const SDK_STORAGE_BACKENDS = ['content', 'd1'] as const;
export const SDK_PICK_STRATEGIES = ['latest', 'highest_priority', 'oldest'] as const;
export const SDK_DISPATCH_EXECUTION_CLASSES = ['local_only', 'remote_inline', 'remote_job'] as const;
export const SDK_DISPATCH_TARGETS = ['local', 'project_api', 'project_runner', 'market_catalog'] as const;
export const SDK_DISPATCH_POLICIES = ['auto', 'prefer_local', 'prefer_remote', 'remote_only'] as const;
export const SDK_DISPATCH_NAMESPACES = ['sdk', 'workflow'] as const;
export const TREESEED_HOSTING_KINDS = ['treeseed_control_plane', 'hosted_project', 'self_hosted_project'] as const;
export const TREESEED_HOSTING_REGISTRATIONS = ['optional', 'none'] as const;
export const PROJECT_CONNECTION_MODES = ['hosted', 'self_hosted', 'hybrid'] as const;
export const PROJECT_RUNNER_REGISTRATION_STATES = ['pending', 'registered', 'offline'] as const;
export const PROJECT_EXECUTION_OWNERS = ['project_api', 'project_runner', 'market'] as const;
export const REMOTE_JOB_STATUSES = ['pending', 'claimed', 'running', 'completed', 'failed', 'cancelled'] as const;
export const PROJECT_ENVIRONMENT_NAMES = ['local', 'staging', 'prod'] as const;
export const PROJECT_DEPLOYMENT_KINDS = ['provision', 'code', 'content', 'mixed'] as const;
export const PROJECT_WEB_DEPLOYMENT_ACTIONS = ['deploy_web', 'publish_content', 'monitor'] as const;
export const PROJECT_DEPLOYMENT_ENVIRONMENTS = ['staging', 'prod'] as const;
export const PROJECT_DEPLOYMENT_STATUSES = ['pending', 'queued', 'claimed', 'dispatching', 'running', 'monitoring', 'succeeded', 'failed', 'cancelled', 'timed_out'] as const;
export const PROJECT_INFRA_RESOURCE_PROVIDERS = ['cloudflare', 'railway', 'github', 'market'] as const;
export const PROJECT_INFRA_RESOURCE_KINDS = [
	'pages',
	'worker',
	'kv',
	'turnstile-widget',
	'r2',
	'd1',
	'queue',
	'dlq',
	'railway_project',
	'railway_service',
	'railway_schedule',
] as const;
export const TREESEED_DEFAULT_STARTER_TEMPLATE_ID = 'research' as const;
export const TREESEED_TEMPLATE_ID_ALIASES = {} as const;
export function normalizeTreeseedTemplateId(templateId: string | null | undefined) {
	const trimmed = String(templateId ?? '').trim();
	return (TREESEED_TEMPLATE_ID_ALIASES as Record<string, string>)[trimmed] ?? trimmed;
}
export const TEMPLATE_HOST_REQUIREMENT_TYPES = ['repository', 'web', 'email', 'ai', 'knowledge-library'] as const;
export const TREEDX_INSTANCE_KINDS = ['managed_private', 'managed_public_federation', 'self_hosted'] as const;
export const TREEDX_INSTANCE_STATUSES = ['pending', 'active', 'degraded', 'offline', 'disabled'] as const;
export const TREEDX_DEPLOYMENT_PROVIDERS = ['railway', 'self_hosted', 'public_federation'] as const;
export const TREEDX_MIRROR_DIRECTIONS = ['pull', 'push', 'bidirectional'] as const;
export const TREEDX_MIRROR_STATUSES = ['pending', 'active', 'syncing', 'degraded', 'disabled'] as const;
export const TREEDX_SHARE_SCOPES = ['team', 'library', 'public_federation'] as const;
export const TREEDX_SHARE_STATUSES = ['active', 'revoked', 'expired'] as const;
export const PROJECT_REPOSITORY_ACCESS_MODES = ['treedx', 'filesystem'] as const;
export const PROJECT_REPOSITORY_TOPOLOGY_PARTS = ['contentRepository', 'siteRepository', 'projectRepository'] as const;
export const TEMPLATE_RESOURCE_REQUIREMENT_TYPES = ['service', 'database', 'object-storage', 'queue', 'dns-zone'] as const;
export const TEMPLATE_SECRET_SENSITIVITIES = ['secret', 'plain', 'derived'] as const;
export const TEMPLATE_SECRET_TARGETS = [
	'github-secret',
	'github-variable',
	'cloudflare-secret',
	'cloudflare-var',
	'railway-secret',
	'railway-var',
	'config-file',
	'local-runtime',
] as const;
export const TEMPLATE_SECRET_SOURCES = ['generated', 'selected-host', 'user-input', 'derived'] as const;
export const TEMPLATE_CONFIG_WRITE_TARGETS = ['treeseed.site.yaml', 'src/env.yaml', 'src/manifest.yaml', 'package.json'] as const;
export const TEMPLATE_CONFIG_WRITE_WHEN = ['always', 'host-selected', 'feature-enabled'] as const;
export const TEMPLATE_CONFIG_MERGE_STRATEGIES = ['replace', 'deep-merge', 'append-unique'] as const;
export const PROJECT_LAUNCH_REQUIREMENT_KINDS = ['host', 'resource', 'secret'] as const;

export type SdkBuiltinModelName = (typeof SDK_MODEL_NAMES)[number];
export type SdkModelName = SdkBuiltinModelName | (string & {});
export type SdkOperation = (typeof SDK_OPERATIONS)[number];
export type SdkStorageBackend = (typeof SDK_STORAGE_BACKENDS)[number];
export type SdkPickStrategy = (typeof SDK_PICK_STRATEGIES)[number];
export type SdkComparableAs = 'string' | 'number' | 'date' | 'boolean' | 'string_array';
export type SdkDispatchExecutionClass = (typeof SDK_DISPATCH_EXECUTION_CLASSES)[number];
export type SdkDispatchTarget = (typeof SDK_DISPATCH_TARGETS)[number];
export type SdkDispatchPolicy = (typeof SDK_DISPATCH_POLICIES)[number];
export type SdkDispatchNamespace = (typeof SDK_DISPATCH_NAMESPACES)[number];
export type TreeseedHostingKind = (typeof TREESEED_HOSTING_KINDS)[number];
export type TreeseedHostingRegistration = (typeof TREESEED_HOSTING_REGISTRATIONS)[number];
export type ProjectConnectionMode = (typeof PROJECT_CONNECTION_MODES)[number];
export type ProjectRunnerRegistrationState = (typeof PROJECT_RUNNER_REGISTRATION_STATES)[number];
export type ProjectExecutionOwner = (typeof PROJECT_EXECUTION_OWNERS)[number];
export type RemoteJobStatus = (typeof REMOTE_JOB_STATUSES)[number];
export type ProjectEnvironmentName = (typeof PROJECT_ENVIRONMENT_NAMES)[number];
export type ProjectDeploymentKind = (typeof PROJECT_DEPLOYMENT_KINDS)[number];
export type ProjectWebDeploymentAction = (typeof PROJECT_WEB_DEPLOYMENT_ACTIONS)[number];
export type ProjectDeploymentEnvironment = (typeof PROJECT_DEPLOYMENT_ENVIRONMENTS)[number];
export type ProjectDeploymentStatus = (typeof PROJECT_DEPLOYMENT_STATUSES)[number];
export type ProjectWebMonitorStatus = 'healthy' | 'degraded' | 'failed' | 'unknown';
export type ProjectWebMonitorCheckStatus = 'passed' | 'warning' | 'failed' | 'skipped';
export type ProjectWebMonitorCheckSource = 'market' | 'github' | 'cloudflare' | 'http' | 'sdk' | 'treedx' | 'r2';
export type ProjectInfrastructureResourceProvider = (typeof PROJECT_INFRA_RESOURCE_PROVIDERS)[number];
export type ProjectInfrastructureResourceKind = (typeof PROJECT_INFRA_RESOURCE_KINDS)[number];
export type RemoteJobRequestedByType = 'user' | 'team_api_key' | 'service' | 'runner' | 'system';
export type TemplateHostRequirementType = (typeof TEMPLATE_HOST_REQUIREMENT_TYPES)[number];
export type TreeDxInstanceKind = (typeof TREEDX_INSTANCE_KINDS)[number];
export type TreeDxInstanceStatus = (typeof TREEDX_INSTANCE_STATUSES)[number];
export type TreeDxDeploymentProvider = (typeof TREEDX_DEPLOYMENT_PROVIDERS)[number];
export type TreeDxMirrorDirection = (typeof TREEDX_MIRROR_DIRECTIONS)[number];
export type TreeDxMirrorStatus = (typeof TREEDX_MIRROR_STATUSES)[number];
export type TreeDxShareScope = (typeof TREEDX_SHARE_SCOPES)[number];
export type TreeDxShareStatus = (typeof TREEDX_SHARE_STATUSES)[number];
export type ProjectRepositoryAccessMode = (typeof PROJECT_REPOSITORY_ACCESS_MODES)[number];
export type ProjectRepositoryTopologyPart = (typeof PROJECT_REPOSITORY_TOPOLOGY_PARTS)[number];
export type TemplateResourceRequirementType = (typeof TEMPLATE_RESOURCE_REQUIREMENT_TYPES)[number];
export type TemplateSecretSensitivity = (typeof TEMPLATE_SECRET_SENSITIVITIES)[number];
export type TemplateSecretTarget = (typeof TEMPLATE_SECRET_TARGETS)[number];
export type TemplateSecretSource = (typeof TEMPLATE_SECRET_SOURCES)[number];
export type TemplateConfigWriteTarget = (typeof TEMPLATE_CONFIG_WRITE_TARGETS)[number];
export type TemplateConfigWriteWhen = (typeof TEMPLATE_CONFIG_WRITE_WHEN)[number];
export type TemplateConfigMergeStrategy = (typeof TEMPLATE_CONFIG_MERGE_STRATEGIES)[number];
export type ProjectLaunchRequirementKind = (typeof PROJECT_LAUNCH_REQUIREMENT_KINDS)[number];

export interface TemplateConfigWrite {
	target: TemplateConfigWriteTarget;
	path: string;
	valueFrom: string;
	writeWhen?: TemplateConfigWriteWhen;
	mergeStrategy?: TemplateConfigMergeStrategy;
}

export interface TemplateEnvironmentWrite {
	env: string;
	valueFrom: string;
	targets?: TemplateSecretTarget[];
	scopes?: ProjectEnvironmentName[];
	sensitivity?: TemplateSecretSensitivity;
}

export interface TemplateHostRequirement {
	kind: 'host';
	key: string;
	type: TemplateHostRequirementType;
	required: boolean;
	compatibleProviders?: string[];
	displayName: string;
	purpose: string;
	defaultSelection?: 'team-default' | 'managed' | 'none';
	configWrites: TemplateConfigWrite[];
	environmentWrites?: TemplateEnvironmentWrite[];
}

export interface TemplateResourceRequirement {
	kind: 'resource';
	key: string;
	type: TemplateResourceRequirementType;
	required: boolean;
	compatibleProviders?: string[];
	displayName: string;
	purpose: string;
	configWrites: TemplateConfigWrite[];
	environmentWrites?: TemplateEnvironmentWrite[];
}

export interface TemplateSecretRequirement {
	kind: 'secret';
	key: string;
	env: string;
	required: boolean;
	sensitivity: TemplateSecretSensitivity;
	targets: TemplateSecretTarget[];
	source: TemplateSecretSource;
}

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
	kind: TreeseedHostingKind,
	registration: TreeseedHostingRegistration = 'none',
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

export const COMMERCE_GOVERNANCE_STATES = [
	'draft',
	'submitted',
	'approved',
	'rejected',
	'suspended',
	'archived',
] as const;

export type CommerceGovernanceState = typeof COMMERCE_GOVERNANCE_STATES[number];

export const COMMERCE_ENTITLEMENT_STATUSES = [
	'pending',
	'active',
	'past_due',
	'expired',
	'revoked',
	'refunded',
	'canceled',
] as const;

export type CommerceEntitlementStatus = typeof COMMERCE_ENTITLEMENT_STATUSES[number];

export const COMMERCE_OWNERSHIP_MODELS = [
	'team_owned',
	'individual_contributor_owned',
	'multi_contributor_attributed',
	'steward_maintained',
	'cooperative_owned',
	'community_governed',
	'foundation_or_trust_held',
	'transferred_or_succeeded',
] as const;

export type CommerceOwnershipModel = typeof COMMERCE_OWNERSHIP_MODELS[number];

export const COMMERCE_STEWARDSHIP_ROLES = [
	'owner',
	'seller',
	'maintainer',
	'governance_steward',
	'support_steward',
	'security_steward',
	'community_steward',
	'successor',
] as const;

export type CommerceStewardshipRole = typeof COMMERCE_STEWARDSHIP_ROLES[number];

export const COMMERCE_OWNERSHIP_TRANSFER_STATUSES = [
	'draft',
	'submitted',
	'approved',
	'rejected',
	'canceled',
	'superseded',
] as const;

export type CommerceOwnershipTransferStatus = typeof COMMERCE_OWNERSHIP_TRANSFER_STATUSES[number];

export const COMMERCE_SUCCESSION_EVENT_TYPES = [
	'successor_named',
	'successor_accepted',
	'succession_triggered',
	'succession_completed',
	'succession_canceled',
] as const;

export type CommerceSuccessionEventType = typeof COMMERCE_SUCCESSION_EVENT_TYPES[number];

export const COMMERCE_GOVERNANCE_DECISION_TYPES = [
	'ownership_record',
	'stewardship_assignment',
	'contribution',
	'governance_policy',
	'ownership_transfer',
	'succession',
] as const;

export type CommerceGovernanceDecisionType = typeof COMMERCE_GOVERNANCE_DECISION_TYPES[number];

export const COMMONS_PARTICIPANT_STATUSES = [
	'active',
	'limited',
	'suspended',
	'archived',
] as const;

export type CommonsParticipantStatus = typeof COMMONS_PARTICIPANT_STATUSES[number];

export const COMMONS_PROPOSAL_STATUSES = [
	'draft',
	'submitted',
	'backing',
	'qualified',
	'under_review',
	'voting',
	'accepted',
	'rejected',
	'deferred',
	'implemented',
	'archived',
] as const;

export type CommonsProposalStatus = typeof COMMONS_PROPOSAL_STATUSES[number];

export const COMMONS_QUESTION_STATUSES = [
	'open',
	'answered',
	'converted_to_proposal',
	'archived',
] as const;

export type CommonsQuestionStatus = typeof COMMONS_QUESTION_STATUSES[number];

export const COMMONS_VOTE_VALUES = [
	'support',
	'object',
	'abstain',
] as const;

export type CommonsVoteValue = typeof COMMONS_VOTE_VALUES[number];

export const COMMONS_DECISION_STATUSES = [
	'proposed',
	'accepted',
	'rejected',
	'scheduled',
	'implemented',
	'archived',
] as const;

export type CommonsDecisionStatus = typeof COMMONS_DECISION_STATUSES[number];

export const COMMONS_GOVERNANCE_EVENT_TYPES = [
	'participant.joined',
	'question.created',
	'question.answered',
	'question.converted_to_proposal',
	'proposal.created',
	'proposal.submitted',
	'proposal.backed',
	'proposal.qualified',
	'proposal.review_started',
	'proposal.voting_started',
	'proposal.voted',
	'proposal.steward_decision',
	'proposal.archived',
	'delegation.created',
	'delegation.revoked',
	'decision.created',
	'decision.updated',
] as const;

export type CommonsGovernanceEventType = typeof COMMONS_GOVERNANCE_EVENT_TYPES[number];

export const COMMERCE_STRIPE_ACCOUNT_STATUSES = [
	'not_started',
	'pending',
	'restricted',
	'enabled',
	'disabled',
] as const;

export type CommerceStripeAccountStatus = typeof COMMERCE_STRIPE_ACCOUNT_STATUSES[number];

export const COMMERCE_STRIPE_ONBOARDING_STATUSES = [
	'not_started',
	'started',
	'returned',
	'completed',
	'expired',
] as const;

export type CommerceStripeOnboardingStatus = typeof COMMERCE_STRIPE_ONBOARDING_STATUSES[number];

export const COMMERCE_STRIPE_ENVIRONMENTS = ['test', 'live'] as const;

export type CommerceStripeEnvironment = typeof COMMERCE_STRIPE_ENVIRONMENTS[number];

export const COMMERCE_STRIPE_SYNC_STATUSES = [
	'not_synced',
	'pending',
	'synced',
	'blocked',
	'drifted',
	'failed',
] as const;

export type CommerceStripeSyncStatus = typeof COMMERCE_STRIPE_SYNC_STATUSES[number];

export const COMMERCE_CART_STATUSES = [
	'active',
	'checkout_pending',
	'converted',
	'abandoned',
] as const;

export type CommerceCartStatus = typeof COMMERCE_CART_STATUSES[number];

export const COMMERCE_CHECKOUT_STATUSES = [
	'draft',
	'requires_confirmation',
	'processing',
	'partially_confirmed',
	'confirmed',
	'completed',
	'canceled',
	'failed',
] as const;

export type CommerceCheckoutStatus = typeof COMMERCE_CHECKOUT_STATUSES[number];

export const COMMERCE_ORDER_STATUSES = [
	'draft',
	'pending_payment',
	'requires_action',
	'processing',
	'paid',
	'partially_refunded',
	'refunded',
	'canceled',
	'failed',
] as const;

export type CommerceOrderStatus = typeof COMMERCE_ORDER_STATUSES[number];

export const COMMERCE_ORDER_ITEM_STATUSES = [
	'pending',
	'paid',
	'fulfilled',
	'refunded',
	'revoked',
	'canceled',
] as const;

export type CommerceOrderItemStatus = typeof COMMERCE_ORDER_ITEM_STATUSES[number];

export const COMMERCE_SUBSCRIPTION_STATUSES = [
	'incomplete',
	'trialing',
	'active',
	'past_due',
	'canceled',
	'unpaid',
	'paused',
] as const;

export type CommerceSubscriptionStatus = typeof COMMERCE_SUBSCRIPTION_STATUSES[number];

export const COMMERCE_PAYMENT_GROUP_STATUSES = [
	'pending',
	'requires_confirmation',
	'requires_action',
	'processing',
	'succeeded',
	'failed',
	'canceled',
] as const;

export type CommercePaymentGroupStatus = typeof COMMERCE_PAYMENT_GROUP_STATUSES[number];

export const COMMERCE_WEBHOOK_EVENT_STATUSES = [
	'received',
	'processing',
	'processed',
	'ignored',
	'failed',
] as const;

export type CommerceWebhookEventStatus = typeof COMMERCE_WEBHOOK_EVENT_STATUSES[number];

export const COMMERCE_REFUND_STATUSES = [
	'processing',
	'succeeded',
	'failed',
	'canceled',
] as const;

export type CommerceRefundStatus = typeof COMMERCE_REFUND_STATUSES[number];

export const COMMERCE_FULFILLMENT_STATUSES = [
	'pending',
	'ready',
	'delivered',
	'failed',
	'revoked',
] as const;

export type CommerceFulfillmentStatus = typeof COMMERCE_FULFILLMENT_STATUSES[number];

export const COMMERCE_FULFILLMENT_EVENT_TYPES = [
	'artifact_released',
	'artifact_delivered',
	'manual_status',
	'revoked',
] as const;

export type CommerceFulfillmentEventType = typeof COMMERCE_FULFILLMENT_EVENT_TYPES[number];

export const COMMERCE_SERVICE_REQUEST_STATUSES = [
	'requested',
	'scoping',
	'quoted',
	'buyer_approved',
	'vendor_approved',
	'checkout_pending',
	'active',
	'fulfilled',
	'declined',
	'canceled',
	'expired',
] as const;

export type CommerceServiceRequestStatus = typeof COMMERCE_SERVICE_REQUEST_STATUSES[number];

export const COMMERCE_SERVICE_QUOTE_STATUSES = [
	'draft',
	'submitted',
	'buyer_approved',
	'vendor_approved',
	'accepted',
	'rejected',
	'expired',
	'superseded',
	'canceled',
] as const;

export type CommerceServiceQuoteStatus = typeof COMMERCE_SERVICE_QUOTE_STATUSES[number];

export const COMMERCE_SERVICE_CONTRACT_STATUSES = [
	'pending_checkout',
	'active',
	'fulfilled',
	'canceled',
	'disputed',
] as const;

export type CommerceServiceContractStatus = typeof COMMERCE_SERVICE_CONTRACT_STATUSES[number];

export const COMMERCE_SERVICE_EVENT_TYPES = [
	'requested',
	'scoping_started',
	'scope_updated',
	'quote_created',
	'quote_submitted',
	'quote_buyer_approved',
	'quote_vendor_approved',
	'quote_rejected',
	'quote_expired',
	'checkout_created',
	'contract_activated',
	'work_linked',
	'manual_update',
	'fulfilled',
	'declined',
	'canceled',
] as const;

export type CommerceServiceEventType = typeof COMMERCE_SERVICE_EVENT_TYPES[number];

export const COMMERCE_CAPACITY_LISTING_STATUSES = [
	'draft',
	'submitted',
	'approved',
	'rejected',
	'suspended',
	'archived',
] as const;

export type CommerceCapacityListingStatus = typeof COMMERCE_CAPACITY_LISTING_STATUSES[number];

export const COMMERCE_CAPACITY_INQUIRY_STATUSES = [
	'requested',
	'reviewing',
	'approved_for_scoping',
	'declined',
	'canceled',
] as const;

export type CommerceCapacityInquiryStatus = typeof COMMERCE_CAPACITY_INQUIRY_STATUSES[number];

export const COMMERCE_CAPACITY_ACCESS_LEVELS = [
	'public_summary',
	'buyer_gated',
	'governance_required',
	'private_invite',
] as const;

export type CommerceCapacityAccessLevel = typeof COMMERCE_CAPACITY_ACCESS_LEVELS[number];

export const COMMERCE_CAPACITY_RUNTIME_ISOLATION_LEVELS = [
	'none',
	'project_scoped',
	'tenant_isolated',
	'dedicated_runtime',
	'external_only',
] as const;

export type CommerceCapacityRuntimeIsolationLevel = typeof COMMERCE_CAPACITY_RUNTIME_ISOLATION_LEVELS[number];

export const COMMERCE_CAPACITY_HUMAN_INVOLVEMENT_LEVELS = [
	'none',
	'review_only',
	'operator_assisted',
	'human_delivered',
] as const;

export type CommerceCapacityHumanInvolvementLevel = typeof COMMERCE_CAPACITY_HUMAN_INVOLVEMENT_LEVELS[number];

export const COMMERCE_CAPACITY_AI_INVOLVEMENT_LEVELS = [
	'none',
	'assistive',
	'agentic',
	'model_hosted',
] as const;

export type CommerceCapacityAiInvolvementLevel = typeof COMMERCE_CAPACITY_AI_INVOLVEMENT_LEVELS[number];

export const COMMERCE_CAPACITY_DATA_ACCESS_LEVELS = [
	'none',
	'public_only',
	'buyer_provided',
	'project_scoped',
	'sensitive_review_required',
] as const;

export type CommerceCapacityDataAccessLevel = typeof COMMERCE_CAPACITY_DATA_ACCESS_LEVELS[number];

export const COMMERCE_CAPACITY_SECRET_ACCESS_LEVELS = [
	'none',
	'buyer_managed',
	'delegated_scoped',
	'market_admin_review_required',
] as const;

export type CommerceCapacitySecretAccessLevel = typeof COMMERCE_CAPACITY_SECRET_ACCESS_LEVELS[number];

export interface CommerceVendor {
	id: string;
	teamId: string;
	displayName: string;
	slug: string;
	status: CommerceGovernanceState;
	trustLevel: CommerceVendorTrustLevel;
	professionalEntitlementId: string | null;
	stripeAccountId: string | null;
	salesEnabled: boolean;
	serviceSalesEnabled: boolean;
	capacityListingsEnabled: boolean;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface StripeConnectedAccount {
	id: string;
	vendorId: string;
	teamId: string;
	environment: CommerceStripeEnvironment;
	stripeAccountId: string;
	accountStatus: CommerceStripeAccountStatus;
	onboardingStatus: CommerceStripeOnboardingStatus;
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	detailsSubmitted: boolean;
	requirementsCurrentlyDue: string[];
	requirementsEventuallyDue: string[];
	requirementsPastDue: string[];
	requirementsDisabledReason: string | null;
	capabilities: Record<string, string>;
	onboardingStartedAt: string | null;
	onboardingCompletedAt: string | null;
	lastSyncedAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceStripeOnboardingRequestInput {
	returnUrl?: string | null;
	refreshUrl?: string | null;
}

export interface CommerceStripeOnboardingResponse {
	account: StripeConnectedAccount;
	onboardingUrl: string;
}

export interface CommerceStripeLoginLinkResponse {
	account: StripeConnectedAccount;
	loginUrl: string;
}

export interface CommerceProduct {
	id: string;
	vendorId: string;
	sellerTeamId: string;
	kind: CommerceProductKind;
	slug: string;
	title: string;
	summary: string | null;
	description: string | null;
	status: CommerceGovernanceState;
	visibility: 'public' | 'authenticated' | 'team' | 'private';
	catalogItemId: string | null;
	currentVersionId: string | null;
	ownershipModel: CommerceOwnershipModel;
	ownershipRecordId: string | null;
	supportPolicy: string | null;
	license: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceOwnershipRecord {
	id: string;
	productId: string;
	model: CommerceOwnershipModel;
	canonicalOwnerType: 'user' | 'team' | 'organization' | 'cooperative' | 'community' | 'foundation' | 'external';
	canonicalOwnerId: string | null;
	sellerTeamId: string;
	stewardTeamId: string | null;
	governancePolicyId: string | null;
	publicSummary: string | null;
	buyerVisible: boolean;
	effectiveAt: string;
	supersededAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceStewardshipAssignment {
	id: string;
	ownershipRecordId: string;
	productId: string;
	role: CommerceStewardshipRole;
	assigneeType: 'user' | 'team' | 'organization' | 'community' | 'external';
	assigneeId: string | null;
	displayName: string | null;
	responsibilities: string[];
	visibleToBuyers: boolean;
	startsAt: string;
	endsAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceContribution {
	id: string;
	productId: string;
	productVersionId: string | null;
	contributorType: 'user' | 'team' | 'organization' | 'external';
	contributorId: string | null;
	displayName: string | null;
	role: string;
	summary: string | null;
	attributionVisibility: 'public' | 'buyer' | 'vendor' | 'private';
	agreementRef: string | null;
	benefitWeight: number | null;
	effectiveAt: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceGovernancePolicy {
	id: string;
	productId: string | null;
	teamId: string | null;
	policyKind: 'product' | 'vendor' | 'cooperative' | 'community';
	title: string;
	approvalRules: Record<string, unknown>;
	quorumRules: Record<string, unknown>;
	buyerVisibleSummary: string | null;
	status: 'draft' | 'active' | 'superseded' | 'archived';
	createdAt: string;
	updatedAt: string;
}

export interface CommerceOwnershipTransfer {
	id: string;
	productId: string;
	fromOwnershipRecordId: string;
	toOwnershipRecordId: string;
	status: CommerceOwnershipTransferStatus;
	reason: string;
	approvalEvidence: Record<string, unknown>;
	buyerVisibleImpact: string | null;
	effectiveAt: string;
	requestedByType: string;
	requestedById: string;
	approvedByType: string | null;
	approvedById: string | null;
	approvedAt: string | null;
	rejectedAt: string | null;
	supersededAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface CommerceSuccessionEvent {
	id: string;
	productId: string;
	ownershipRecordId: string | null;
	stewardshipAssignmentId: string | null;
	successorType: string;
	successorId: string;
	eventType: CommerceSuccessionEventType;
	status: CommerceOwnershipTransferStatus;
	reason: string | null;
	evidence?: Record<string, unknown>;
	effectiveAt: string | null;
	createdByType: string;
	createdById: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface CommerceOwnershipWorkflowSummary {
	productId: string;
	currentOwnershipRecord: CommerceOwnershipRecord | null;
	buyerVisibleOwnershipRecords: CommerceOwnershipRecord[];
	stewardshipAssignments: CommerceStewardshipAssignment[];
	contributions: CommerceContribution[];
	governancePolicies: CommerceGovernancePolicy[];
	pendingTransfers: CommerceOwnershipTransfer[];
	successionEvents: CommerceSuccessionEvent[];
}

export interface CommerceOwnershipRecordUpdateInput {
	publicSummary?: string | null;
	buyerVisible?: boolean;
	metadata?: Record<string, unknown>;
}

export interface CommerceStewardshipAssignmentUpdateInput {
	displayName?: string | null;
	responsibilities?: Record<string, unknown>;
	visibleToBuyers?: boolean;
	endsAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceContributionUpdateInput {
	summary?: string | null;
	attributionVisibility?: string;
	benefitWeight?: number | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceGovernancePolicyUpdateInput {
	title?: string;
	approvalRules?: Record<string, unknown>;
	quorumRules?: Record<string, unknown>;
	buyerVisibleSummary?: string | null;
	status?: CommerceGovernanceState;
}

export interface CommerceOwnershipTransferDecisionInput {
	reason?: string | null;
	evidence?: Record<string, unknown>;
}

export interface CommerceSuccessionEventInput {
	ownershipRecordId?: string | null;
	stewardshipAssignmentId?: string | null;
	successorType: string;
	successorId: string;
	eventType: CommerceSuccessionEventType;
	reason?: string | null;
	evidence?: Record<string, unknown>;
	effectiveAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceCapacityListing {
	id: string;
	productId: string;
	vendorId: string;
	sellerTeamId: string;
	capacityProviderId: string | null;
	executionProviderId: string | null;
	status: CommerceCapacityListingStatus;
	accessLevel: CommerceCapacityAccessLevel;
	runtimeIsolationLevel: CommerceCapacityRuntimeIsolationLevel;
	humanInvolvementLevel: CommerceCapacityHumanInvolvementLevel;
	aiInvolvementLevel: CommerceCapacityAiInvolvementLevel;
	dataAccessLevel: CommerceCapacityDataAccessLevel;
	secretAccessLevel: CommerceCapacitySecretAccessLevel;
	supportedServiceTypes: string[];
	supportedRegions: string[];
	runtimeRequirements: Record<string, unknown>;
	dataHandlingSummary: string | null;
	buyerVisibleRiskSummary: string | null;
	governanceRequirements: Record<string, unknown>;
	supportPolicy: string | null;
	availabilitySummary: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceCapacityListingInquiry {
	id: string;
	listingId: string;
	productId: string;
	vendorId: string;
	sellerTeamId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	status: CommerceCapacityInquiryStatus;
	requestedServiceType: string | null;
	requestedScope: string;
	dataAccessRequested: Record<string, unknown>;
	secretAccessRequested: Record<string, unknown>;
	relatedProjectId: string | null;
	relatedWorkdayId: string | null;
	governanceEvidence?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceCapacityListingInput {
	capacityProviderId?: string | null;
	executionProviderId?: string | null;
	accessLevel?: CommerceCapacityAccessLevel;
	runtimeIsolationLevel?: CommerceCapacityRuntimeIsolationLevel;
	humanInvolvementLevel?: CommerceCapacityHumanInvolvementLevel;
	aiInvolvementLevel?: CommerceCapacityAiInvolvementLevel;
	dataAccessLevel?: CommerceCapacityDataAccessLevel;
	secretAccessLevel?: CommerceCapacitySecretAccessLevel;
	supportedServiceTypes?: string[];
	supportedRegions?: string[];
	runtimeRequirements?: Record<string, unknown>;
	dataHandlingSummary?: string | null;
	buyerVisibleRiskSummary?: string | null;
	governanceRequirements?: Record<string, unknown>;
	supportPolicy?: string | null;
	availabilitySummary?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceCapacityListingInquiryInput {
	requestedServiceType?: string | null;
	requestedScope: string;
	dataAccessRequested?: Record<string, unknown>;
	secretAccessRequested?: Record<string, unknown>;
	relatedProjectId?: string | null;
	relatedWorkdayId?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceCapacityInquiryDecisionInput {
	reason?: string | null;
	evidence?: Record<string, unknown>;
}

export interface CommerceProductVersion {
	id: string;
	productId: string;
	version: string;
	status: CommerceGovernanceState;
	catalogArtifactVersionId: string | null;
	manifestKey: string | null;
	artifactKey: string | null;
	integrity: string | null;
	releaseNotes: string | null;
	compatibility: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	publishedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceOffer {
	id: string;
	productId: string;
	productVersionId: string | null;
	vendorId: string;
	sellerTeamId: string;
	mode: CommerceOfferMode;
	status: CommerceGovernanceState;
	title: string;
	termsSummary: string | null;
	accessScope: Record<string, unknown>;
	supportScope: Record<string, unknown>;
	fulfillmentMode: 'automatic' | 'manual' | 'scoped' | 'external';
	activePriceId: string | null;
	stripeProductId: string | null;
	stripeProductStatus: CommerceStripeSyncStatus;
	stripeProductSyncedAt: string | null;
	stripeProductSyncError: string | null;
	stripeProductMetadata?: Record<string, unknown>;
	startsAt: string | null;
	endsAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommercePrice {
	id: string;
	offerId: string;
	amount: number;
	currency: string;
	billingInterval: 'one_time' | 'month' | 'year' | 'custom';
	status: 'draft' | 'active' | 'archived';
	stripeProductId: string | null;
	stripePriceId: string | null;
	stripeLookupKey: string | null;
	stripeSyncStatus: CommerceStripeSyncStatus;
	stripeSyncedAt: string | null;
	stripeSyncError: string | null;
	stripeMetadata?: Record<string, unknown>;
	priceVersion: number;
	taxBehavior: 'exclusive' | 'inclusive' | 'unspecified';
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceStripeProductSyncResult {
	offer: CommerceOffer;
	product: CommerceProduct;
	vendor: CommerceVendor;
	connectedAccount: StripeConnectedAccount;
	stripeProductId: string;
	status: CommerceStripeSyncStatus;
	reconciled: boolean;
}

export interface CommerceStripePriceSyncResult {
	offer: CommerceOffer;
	price: CommercePrice;
	connectedAccount: StripeConnectedAccount;
	stripeProductId: string;
	stripePriceId: string;
	stripeLookupKey: string;
	status: CommerceStripeSyncStatus;
	reconciled: boolean;
}

export interface CommerceCart {
	id: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	status: CommerceCartStatus;
	currency: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceCartItem {
	id: string;
	cartId: string;
	vendorId: string;
	sellerTeamId: string;
	productId: string;
	productVersionId: string | null;
	offerId: string;
	priceId: string | null;
	quantity: number;
	unitAmount: number;
	currency: string;
	mode: CommerceOfferMode;
	status: 'active' | 'removed' | 'converted';
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceCheckout {
	id: string;
	cartId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	status: CommerceCheckoutStatus;
	checkoutMode: 'stripe_elements_grouped_vendor';
	groupCount: number;
	completedGroupCount: number;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceOrder {
	id: string;
	checkoutId: string | null;
	cartId: string | null;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	vendorId: string | null;
	sellerTeamId: string | null;
	status: CommerceOrderStatus;
	currency: string;
	subtotalAmount: number;
	totalAmount: number;
	refundedAmount: number;
	refundStatus: 'none' | 'partial' | 'full';
	stripeCheckoutSessionId: string | null;
	stripePaymentIntentId: string | null;
	stripeSubscriptionId: string | null;
	stripeCustomerId: string | null;
	stripeConnectedAccountId: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceOrderItem {
	id: string;
	orderId: string;
	vendorId: string;
	sellerTeamId: string;
	productId: string;
	productVersionId: string | null;
	offerId: string;
	priceId: string;
	mode: CommerceOfferMode;
	quantity: number;
	unitAmount: number;
	totalAmount: number;
	refundedAmount: number;
	refundStatus: 'none' | 'partial' | 'full';
	currency: string;
	status: CommerceOrderItemStatus;
	entitlementId: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	accessScope: Record<string, unknown>;
	supportScope: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommercePaymentGroup {
	id: string;
	checkoutId: string;
	orderId: string;
	vendorId: string;
	sellerTeamId: string;
	connectedAccountId: string | null;
	groupKind: 'free' | 'one_time' | 'subscription';
	billingInterval: 'one_time' | 'month' | 'year' | null;
	status: CommercePaymentGroupStatus;
	currency: string;
	subtotalAmount: number;
	totalAmount: number;
	stripePaymentIntentId: string | null;
	stripeSubscriptionId: string | null;
	stripeCustomerId: string | null;
	clientSecret: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceSubscription {
	id: string;
	orderId: string;
	vendorId: string;
	sellerTeamId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	offerId: string;
	priceId: string;
	status: CommerceSubscriptionStatus;
	renewalState: CommerceEntitlement['renewalState'];
	stripeSubscriptionId: string;
	stripeCustomerId: string | null;
	stripeConnectedAccountId: string;
	currentPeriodStart: string | null;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	canceledAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceEntitlement {
	id: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	sellerTeamId: string;
	productId: string;
	productVersionId: string | null;
	offerId: string;
	orderId: string | null;
	orderItemId: string | null;
	subscriptionId: string | null;
	status: CommerceEntitlementStatus;
	accessScope: Record<string, unknown>;
	startsAt: string | null;
	endsAt: string | null;
	renewalState: 'none' | 'active' | 'past_due' | 'canceling' | 'canceled';
	fulfillmentArtifactRefs: string[];
	projectId: string | null;
	catalogItemId: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceBuyerStripeCustomer {
	id: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	vendorId: string;
	connectedAccountId: string;
	environment: CommerceStripeEnvironment;
	stripeCustomerId: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceWebhookEvent {
	id: string;
	provider: 'stripe';
	environment: CommerceStripeEnvironment;
	eventId: string;
	eventType: string;
	connectedAccountId: string | null;
	status: CommerceWebhookEventStatus;
	objectType: string | null;
	objectId: string | null;
	relatedOrderId: string | null;
	relatedSubscriptionId: string | null;
	payloadHash: string;
	processingError: string | null;
	receivedAt: string;
	processedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceCheckoutCreateInput {
	buyerTeamId?: string | null;
	items: Array<{
		offerId: string;
		priceId?: string | null;
		quantity?: number;
	}>;
}

export interface CommerceCheckoutResponse {
	checkout: CommerceCheckout;
	orders: CommerceOrder[];
	paymentGroups: CommercePaymentGroup[];
	entitlements: CommerceEntitlement[];
}

export interface CommercePaymentGroupRefreshResponse {
	paymentGroup: CommercePaymentGroup;
	clientSecret: string | null;
}

export interface CommerceMarketplaceOfferSummary {
	id: string;
	mode: CommerceOfferMode;
	title: string;
	status: CommerceGovernanceState;
	priceId: string | null;
	unitAmount: number | null;
	currency: string | null;
	billingInterval: string | null;
	checkoutEligible: boolean;
	serviceEligible: boolean;
	capacityInquiryEligible: boolean;
	stripeSyncStatus: CommerceStripeSyncStatus | null;
}

export interface CommerceMarketplaceProductSummary {
	id: string;
	kind: CommerceProductKind;
	title: string;
	slug: string | null;
	summary: string | null;
	status: CommerceGovernanceState;
	vendorId: string;
	sellerTeamId: string;
	vendorDisplayName: string | null;
	ownershipModel: CommerceOwnershipModel | null;
	buyerVisibleOwnershipSummary: string | null;
	stewardshipSummary: Record<string, unknown>[];
	offers: CommerceMarketplaceOfferSummary[];
	capacityListingId: string | null;
	serviceRequestEligible: boolean;
	checkoutEligible: boolean;
	updatedAt: string;
}

export interface CommerceMarketplaceCatalogResponse {
	products: CommerceMarketplaceProductSummary[];
}

export interface CommerceRefund {
	id: string;
	orderId: string;
	orderItemId: string | null;
	paymentGroupId: string | null;
	vendorId: string;
	sellerTeamId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	amount: number;
	currency: string;
	status: CommerceRefundStatus;
	reason: string | null;
	stripeRefundId: string | null;
	stripePaymentIntentId: string | null;
	stripeConnectedAccountId: string | null;
	idempotencyKey: string;
	requestedByType: string;
	requestedById: string;
	failureReason: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceVendorSalesSummary {
	vendorId: string;
	sellerTeamId: string;
	currency: string | null;
	grossPaidAmount: number;
	refundedAmount: number;
	netPaidAmount: number;
	paidOrderCount: number;
	refundedOrderCount: number;
	activeSubscriptionCount: number;
	activeEntitlementCount: number;
	pendingFulfillmentCount: number;
}

export interface CommerceCommerceMonitor {
	vendorId: string | null;
	sellerTeamId: string;
	stripeReady: boolean;
	blockedStripeSyncCount: number;
	driftedStripeSyncCount: number;
	pendingFulfillmentCount: number;
	failedRefundCount: number;
	failedWebhookCount: number;
	pendingServiceRequestCount: number;
	pendingCapacityInquiryCount: number;
	pendingGovernanceTransferCount: number;
	recentGovernanceEvents: CommerceGovernanceEvent[];
	updatedAt: string;
}

export interface CommerceVendorOrderSummary {
	id: string;
	checkoutId: string | null;
	status: CommerceOrderStatus;
	currency: string;
	totalAmount: number;
	refundedAmount: number;
	buyerTeamId: string | null;
	buyerDisplayName: string | null;
	buyerUserIdRedacted: string | null;
	itemCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceRefundCreateInput {
	orderItemId?: string | null;
	amount?: number | null;
	reason?: string | null;
	idempotencyKey?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceArtifactDeliveryInput {
	catalogArtifactVersionId?: string | null;
	artifactRefs?: Record<string, unknown>[];
	message?: string | null;
}

export interface CommerceServiceRequest {
	id: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	vendorId: string;
	sellerTeamId: string;
	productId: string;
	offerId: string;
	status: CommerceServiceRequestStatus;
	requestedScope: string;
	approvedScope: string | null;
	accessNeeds: Record<string, unknown>;
	buyerVisibleSummary: string | null;
	vendorPrivateNotes: string | null;
	activeQuoteId: string | null;
	approvedQuoteId: string | null;
	contractId: string | null;
	relatedProjectId: string | null;
	relatedWorkdayId: string | null;
	orderId: string | null;
	entitlementId: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceServiceQuote {
	id: string;
	requestId: string;
	vendorId: string;
	sellerTeamId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	quoteVersion: number;
	status: CommerceServiceQuoteStatus;
	title: string;
	scopeSummary: string;
	deliverables: Record<string, unknown>[];
	assumptions: Record<string, unknown>[];
	accessRequirements: Record<string, unknown>;
	governanceRequirements: Record<string, unknown>;
	amount: number;
	currency: string;
	expiresAt: string | null;
	buyerApprovedAt: string | null;
	vendorApprovedAt: string | null;
	acceptedAt: string | null;
	rejectedAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceServiceContract {
	id: string;
	requestId: string;
	quoteId: string;
	vendorId: string;
	sellerTeamId: string;
	buyerTeamId: string | null;
	buyerUserId: string | null;
	productId: string;
	offerId: string;
	status: CommerceServiceContractStatus;
	amount: number;
	currency: string;
	orderId: string | null;
	orderItemId: string | null;
	paymentGroupId: string | null;
	entitlementId: string | null;
	relatedProjectId: string | null;
	relatedWorkdayId: string | null;
	ownershipSnapshot?: Record<string, unknown>;
	accessApprovalSnapshot?: Record<string, unknown>;
	fulfillmentSummary: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommerceServiceEvent {
	id: string;
	requestId: string;
	quoteId: string | null;
	contractId: string | null;
	eventType: CommerceServiceEventType;
	actorType: string;
	actorId: string | null;
	priorState: string | null;
	nextState: string | null;
	message: string | null;
	evidence?: Record<string, unknown>;
	createdAt: string;
}

export interface CommerceServiceRequestInput {
	buyerTeamId?: string | null;
	offerId: string;
	requestedScope: string;
	accessNeeds?: Record<string, unknown>;
	relatedProjectId?: string | null;
	relatedWorkdayId?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceServiceQuoteInput {
	title: string;
	scopeSummary: string;
	deliverables?: Record<string, unknown>[];
	assumptions?: Record<string, unknown>[];
	accessRequirements?: Record<string, unknown>;
	governanceRequirements?: Record<string, unknown>;
	amount: number;
	currency: string;
	expiresAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CommerceServiceDecisionInput {
	reason?: string | null;
	evidence?: Record<string, unknown>;
}

export interface CommerceServiceFulfillmentInput {
	summary?: string | null;
	artifactRefs?: Record<string, unknown>[];
	deliveryRefs?: Record<string, unknown>[];
	metadata?: Record<string, unknown>;
}

export interface CommerceFulfillmentEvent {
	id: string;
	orderId: string;
	orderItemId: string | null;
	entitlementId: string | null;
	vendorId: string;
	sellerTeamId: string;
	productId: string;
	productVersionId: string | null;
	catalogItemId: string | null;
	catalogArtifactVersionId: string | null;
	eventType: CommerceFulfillmentEventType;
	status: CommerceFulfillmentStatus;
	artifactRefs: Record<string, unknown>[];
	deliveryRefs: Record<string, unknown>[];
	message: string | null;
	actorType: string;
	actorId: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface CommerceGovernanceEvent {
	id: string;
	actorType: 'system' | 'user' | 'team' | 'operator';
	actorId: string | null;
	action: string;
	objectType: string;
	objectId: string;
	priorState: string | null;
	nextState: string | null;
	reason: string | null;
	evidence: Record<string, unknown>;
	relatedOrderId: string | null;
	relatedOfferId: string | null;
	relatedProductId: string | null;
	relatedTeamId: string | null;
	createdAt: string;
}

export interface CommonsParticipant {
	id: string;
	userId: string;
	teamId: string;
	status: CommonsParticipantStatus;
	displayName: string | null;
	verifiedEmail: boolean;
	baseWeight: number;
	trustWeight: number;
	contributionWeight: number;
	stakeholderWeight: number;
	delegatedWeight: number;
	totalWeight: number;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommonsQuestion {
	id: string;
	participantId: string;
	userId: string;
	teamId: string;
	status: CommonsQuestionStatus;
	title: string;
	body: string;
	answer: string | null;
	convertedProposalId: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommonsProposal {
	id: string;
	participantId: string;
	userId: string;
	teamId: string;
	status: CommonsProposalStatus;
	title: string;
	summary: string;
	body: string;
	scope: string;
	decisionType: string;
	contentProposalSlug: string | null;
	contentDecisionSlug: string | null;
	backingCount: number;
	voteSupportWeight: number;
	voteObjectWeight: number;
	voteAbstainWeight: number;
	qualifiedAt: string | null;
	votingStartsAt: string | null;
	votingEndsAt: string | null;
	stewardDecisionAt: string | null;
	stewardDecisionBy: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommonsProposalBacking {
	id: string;
	proposalId: string;
	participantId: string;
	userId: string;
	weightSnapshotId: string;
	weight: number;
	reason: string | null;
	createdAt: string;
}

export interface CommonsProposalVote {
	id: string;
	proposalId: string;
	participantId: string;
	userId: string;
	vote: CommonsVoteValue;
	weightSnapshotId: string;
	weight: number;
	reason: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CommonsDelegation {
	id: string;
	fromParticipantId: string;
	toParticipantId: string;
	scope: string;
	status: 'active' | 'revoked';
	weightLimit: number | null;
	reason: string | null;
	createdAt: string;
	revokedAt: string | null;
}

export interface CommonsWeightSnapshot {
	id: string;
	participantId: string;
	policyVersion: string;
	baseWeight: number;
	verifiedEmailWeight: number;
	accountAgeWeight: number;
	contributionWeight: number;
	stakeholderWeight: number;
	trustRoleWeight: number;
	delegatedWeight: number;
	totalWeight: number;
	evidence?: Record<string, unknown>;
	createdAt: string;
}

export interface CommonsDecision {
	id: string;
	proposalId: string;
	status: CommonsDecisionStatus;
	decisionRecordId: string | null;
	decisionRecordSlug: string | null;
	title: string;
	summary: string;
	stewardReason: string | null;
	capacityBudget: string | null;
	scheduledFor: string | null;
	implementedAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CommonsGovernanceEvent {
	id: string;
	eventType: CommonsGovernanceEventType;
	actorType: string;
	actorId: string | null;
	participantId: string | null;
	proposalId: string | null;
	questionId: string | null;
	decisionId: string | null;
	priorState: string | null;
	nextState: string | null;
	message: string | null;
	evidence?: Record<string, unknown>;
	createdAt: string;
}

export interface CommonsQuestionInput {
	title: string;
	body: string;
	metadata?: Record<string, unknown>;
}

export interface CommonsProposalInput {
	title: string;
	summary: string;
	body: string;
	scope?: string;
	decisionType?: string;
	metadata?: Record<string, unknown>;
}

export interface CommonsDecisionInput {
	reason?: string | null;
	evidence?: Record<string, unknown>;
	capacityBudget?: string | null;
	scheduledFor?: string | null;
}

export interface TeamStorageLocator {
	id: string;
	teamId: string;
	bucketName: string;
	manifestKeyTemplate: string;
	previewRootTemplate: string;
	publicBaseUrl: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CatalogItem {
	id: string;
	teamId: string;
	kind: string;
	slug: string;
	title: string;
	summary: string | null;
	visibility: 'public' | 'authenticated' | 'team' | 'private';
	listingEnabled: boolean;
	offerMode: CatalogItemOfferMode;
	manifestKey: string | null;
	artifactKey: string | null;
	searchText: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CatalogArtifactVersion {
	id: string;
	itemId: string;
	teamId: string;
	kind: string;
	version: string;
	contentKey: string;
	manifestKey: string | null;
	metadata?: Record<string, unknown>;
	publishedAt: string;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectHosting {
	id: string;
	projectId: string;
	kind: TreeseedHostingKind;
	registration: TreeseedHostingRegistration;
	marketBaseUrl: string | null;
	sourceRepoOwner: string | null;
	sourceRepoName: string | null;
	sourceRepoUrl: string | null;
	sourceRepoWorkflowPath: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface EncryptedWebHostPayload {
	version: number;
	algorithm: string;
	kdf: {
		algorithm: string;
		opsLimit?: number;
		memLimit?: number;
		[key: string]: unknown;
	};
	salt: string;
	nonce: string;
	ciphertext: string;
}

export type TeamWebHostProvider = 'cloudflare' | 'railway' | 'openai' | 'github_copilot' | 'openrouter' | 'custom';
export type TeamWebHostOwnership = 'team_owned' | 'treeseed_managed';

export interface TeamWebHost {
	id: string;
	teamId: string;
	provider: TeamWebHostProvider;
	ownership: TeamWebHostOwnership;
	name: string;
	accountLabel: string | null;
	allowedEnvironments: ProjectEnvironmentName[];
	status: string;
	encryptedPayload: EncryptedWebHostPayload | null;
	metadata?: Record<string, unknown>;
	createdById: string | null;
	updatedById: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface UpsertTeamWebHostRequest {
	id?: string;
	provider?: TeamWebHostProvider;
	ownership?: TeamWebHostOwnership;
	name: string;
	accountLabel?: string | null;
	allowedEnvironments?: ProjectEnvironmentName[];
	status?: string;
	encryptedPayload?: EncryptedWebHostPayload | null;
	metadata?: Record<string, unknown> | null;
}

export interface ProjectEnvironment {
	id: string;
	projectId: string;
	environment: ProjectEnvironmentName;
	deploymentProfile: TreeseedHostingKind;
	baseUrl: string | null;
	cloudflareAccountId: string | null;
	pagesProjectName: string | null;
	workerName: string | null;
	r2BucketName: string | null;
	d1DatabaseName: string | null;
	queueName: string | null;
	railwayProjectName: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectInfrastructureResource {
	id: string;
	projectId: string;
	environment: ProjectEnvironmentName;
	provider: ProjectInfrastructureResourceProvider;
	resourceKind: ProjectInfrastructureResourceKind;
	logicalName: string;
	locator: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectDeployment {
	id: string;
	teamId: string | null;
	projectId: string;
	environment: ProjectEnvironmentName;
	deploymentKind: ProjectDeploymentKind;
	action: ProjectWebDeploymentAction | string;
	status: ProjectDeploymentStatus;
	platformOperationId: string | null;
	retryOfDeploymentId: string | null;
	resumedFromDeploymentId: string | null;
	idempotencyKey: string | null;
	requestedByUserId: string | null;
	sourceRef: string | null;
	releaseTag: string | null;
	commitSha: string | null;
	triggeredByType: string | null;
	triggeredById: string | null;
	repository?: Record<string, unknown>;
	externalWorkflow?: Record<string, unknown>;
	target?: Record<string, unknown>;
	monitor?: Record<string, unknown>;
	summary: string | null;
	error?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	startedAt: string | null;
	finishedAt: string | null;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
}

export interface ProjectWebMonitorCheck {
	key: string;
	label: string;
	status: ProjectWebMonitorCheckStatus;
	summary: string;
	source: ProjectWebMonitorCheckSource;
	url?: string;
	inspectCommand?: string;
}

export interface ProjectWebMonitorResult {
	environment: ProjectDeploymentEnvironment;
	status: ProjectWebMonitorStatus;
	checkedAt: string;
	checks: ProjectWebMonitorCheck[];
	urls: string[];
	warnings: string[];
	contentRuntime?: {
		contentRuntimeSource: string;
		effectiveContentSource: string;
		manifestKey: string | null;
		overlayKey?: string | null;
		revision?: string | null;
		snapshotId?: string | null;
		diagnostics: Array<{
			code: string;
			status: string;
			summary: string;
			source: string;
		}>;
	};
}

export interface ProjectDeploymentEvent {
	id: string;
	deploymentId: string;
	projectId: string;
	teamId: string;
	operationId: string | null;
	kind: string;
	message: string;
	status: string | null;
	severity: string;
	sequence: number;
	payload?: Record<string, unknown>;
	createdAt: string;
}

export interface ProjectDeploymentActionAvailability {
	environment: ProjectDeploymentEnvironment;
	action: ProjectWebDeploymentAction;
	available: boolean;
	blockedBy: Array<{
		code: string;
		message: string;
		href?: string;
	}>;
}

export interface ProjectDeploymentReadiness {
	ready: boolean;
	blockers: Array<{ code: string; message: string; href?: string }>;
	checks: Array<{ code: string; label: string; ready: boolean; message: string; href?: string }>;
}

export interface CreateProjectWebDeploymentRequest {
	environment: ProjectDeploymentEnvironment;
	action: ProjectWebDeploymentAction;
	source?: 'market_ui' | 'api' | 'cli' | 'launch_flow';
	reason?: string;
	idempotencyKey?: string;
	previewId?: string | null;
	planOnly?: boolean;
	confirmProduction?: boolean;
}

export interface CreateProjectWebDeploymentResponse {
	ok: true;
	deployment: ProjectDeployment;
	operation: Record<string, unknown>;
	pollUrl: string;
	eventsUrl: string;
	stateUrl: string;
}

export type CapacityScarcityLevel = 'low' | 'medium' | 'high';
export type CapacityEstimatePhase = 'intent' | 'discovery' | 'plan' | 'execution' | 'actual';
export type CapacityEstimateConfidence = 'low' | 'medium' | 'high';
export type CapacityApprovalState = 'pending' | 'approved' | 'changes_requested' | 'deferred' | 'rejected' | 'expired' | 'superseded';
export type TaskRiskClass = 'low' | 'medium' | 'high';
export type TaskMutationScope = 'none' | 'repository_read' | 'repository_write' | 'production';
export type TaskConcurrencyClass = 'read_only' | 'repository_claim' | 'exclusive_project' | 'human_attention';
export type TaskAdmissionOutcome =
	| 'admitted'
	| 'planning_required'
	| 'approval_required'
	| 'budget_blocked'
	| 'deferred'
	| 'rejected';
export type CanonicalTaskState =
	| 'pending'
	| 'queued'
	| 'claimed'
	| 'running'
	| 'completed'
	| 'failed'
	| 'waiting'
	| 'paused_for_approval'
	| 'checkpointing'
	| 'checkpointed'
	| 'continuation_required'
	| 'rollback_required'
	| 'rollback_complete'
	| 'provider_exhausted'
	| 'reservation_exhausted';
export type RepositoryWorkState =
	| 'clean'
	| 'claimed_dirty'
	| 'checkpointed_dirty'
	| 'parked_dirty'
	| 'rollback_required';

export interface TaskClassification {
	taskSignature: string;
	risk: TaskRiskClass;
	mutationScope: TaskMutationScope;
	concurrencyClass: TaskConcurrencyClass;
	expectedFanout: number;
	confidence: CapacityEstimateConfidence;
	requiresPlanning: boolean;
	requiresApproval: boolean;
	features?: Record<string, unknown>;
}

export interface AttentionEstimate {
	attentionWeight: number;
	coordinationWeight: number;
	totalAttentionWeight: number;
	estimatedContextTokens: number;
	requiredContextTokens: number;
	source: string;
	metadata?: Record<string, unknown>;
}

export interface AttentionPolicy {
	maxAttentionLoad: number | null;
	reserveAttentionPercent: number;
	maxContextTokens: number | null;
	maxContextSaturationPercent: number;
	coordinationOverheadFactor: number;
}

export interface UtilityEstimate {
	utilityValue: number;
	maintenanceValue: number;
	deadlinePressure: number;
	successProbability: number;
	qualityScore: number;
	riskPenalty: number;
	utilityScore: number;
	utilityPerCredit: number;
	source: string;
	metadata?: Record<string, unknown>;
}

export interface UtilityPolicy {
	minimumUtilityScore: number | null;
	minimumUtilityPerCredit: number | null;
	riskPenaltyFactor: number;
	deadlineWindowHours: number;
	maintenanceWeight: number;
	priorityWeight: number;
}

export interface PredictiveReservePolicy {
	enabled: boolean;
	baseReservePercent: number;
	maxReservePercent: number;
	incidentReservePercent: number;
	triggerBurstReservePercent: number;
	deploymentWindowReservePercent: number;
	providerDegradationReservePercent: number;
	quotaPressureReservePercent: number;
}

export interface ReservePrediction {
	reservePercent: number;
	reserveCredits: number;
	activelyAllocatableCredits: number;
	reasons: string[];
	signals: Record<string, unknown>;
}

export interface HybridExecutionPhase {
	id: string;
	kind: 'planning' | 'implementation' | 'review' | 'human_escalation' | string;
	executionProfileId: string;
	taskSignature?: string | null;
	required: boolean;
	admissionRequired: boolean;
	mutationAllowed: boolean;
	metadata?: Record<string, unknown>;
}

export interface HybridExecutionPlan {
	schemaVersion: 1;
	planId: string;
	phases: HybridExecutionPhase[];
	escalationPolicy?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface WorkdayBudgetEnvelope {
	dailyCreditBudget: number;
	usedCredits: number;
	queuedCredits: number;
	reserveBufferCredits: number;
	recoveryBudgetCredits: number;
	activelyAllocatableCredits: number;
	remainingCredits: number;
}

export interface TaskAdmissionPolicy {
	planningThresholdCredits: number;
	approvalThresholdCredits: number;
	reserveBufferPercent: number;
	recoveryBudgetCredits: number;
	maxDownstreamTasks: number;
	maxPlanningDepth: number;
	maxAdmittedPlanTasksPerCycle: number;
	planningTaskSignature: string;
	allowBackfill?: boolean;
	maxAttentionLoad?: number | null;
	reserveAttentionPercent?: number | null;
	maxContextTokens?: number | null;
	maxContextSaturationPercent?: number | null;
	coordinationOverheadFactor?: number | null;
	predictiveReservePolicy?: Partial<PredictiveReservePolicy> | null;
	utilityPolicy?: Partial<UtilityPolicy> | null;
}

export interface TaskAdmissionDecision {
	outcome: TaskAdmissionOutcome;
	taskSignature: string;
	estimatedCreditsP50: number;
	estimatedCreditsP90: number;
	reservedCredits: number;
	baseReservedCredits?: number;
	executionProfileId?: string | null;
	costMultiplier?: number | null;
	reasons: string[];
	requiresApproval: boolean;
	requiresPlanning: boolean;
	budget: WorkdayBudgetEnvelope;
	policySnapshot: TaskAdmissionPolicy;
	metadata?: Record<string, unknown>;
}

export interface TaskCheckpointArtifact {
	id?: string;
	taskId: string;
	checkpointId?: string;
	branch?: string | null;
	baseCommit?: string | null;
	currentCommit?: string | null;
	currentGoal?: string | null;
	currentPhase?: string | null;
	filesChanged: string[];
	commandsRun: string[];
	testStatus?: 'not_run' | 'passing' | 'failing' | 'unknown' | string;
	knownFailures: string[];
	completedWork: string[];
	remainingWorkEstimate?: {
		p50: number;
		p90: number;
	} | null;
	rollbackStrategy?: string | null;
	continuationStrategy?: string | null;
	repositoryState: RepositoryWorkState;
	createdAt: string;
	metadata?: Record<string, unknown>;
}

export interface PlannedTaskNode {
	id?: string;
	type: string;
	agentId?: string | null;
	title?: string | null;
	priority?: number | null;
	taskSignature?: string | null;
	payload?: Record<string, unknown>;
	estimatedCreditsP50?: number | null;
	estimatedCreditsP90?: number | null;
	risk?: TaskRiskClass | null;
	mutationScope?: TaskMutationScope | null;
	confidence?: CapacityEstimateConfidence | null;
	expectedFanout?: number | null;
	requiresApproval?: boolean | null;
	requiresPlanning?: boolean | null;
	dependsOn?: string[];
	metadata?: Record<string, unknown>;
}

export interface TaskPlanProposal {
	schemaVersion: 1;
	planId: string;
	sourceTaskId?: string | null;
	parentTaskId?: string | null;
	planningDepth: number;
	tasks: PlannedTaskNode[];
	totalEstimatedCreditsP50: number;
	totalEstimatedCreditsP90: number;
	createdAt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface PlanningPolicy {
	maxDownstreamTasks: number;
	maxPlanningDepth: number;
	maxAdmittedPlanTasksPerCycle: number;
	planningTaskSignature: string;
}

export interface PlanningAdmissionResult {
	proposal: TaskPlanProposal;
	admitted: PlannedTaskNode[];
	deferred: PlannedTaskNode[];
	rejected: Array<{
		node: PlannedTaskNode;
		reasons: string[];
	}>;
	totalEstimatedCreditsP50: number;
	totalEstimatedCreditsP90: number;
	admittedCreditsP90: number;
	reasons: string[];
}

export interface CreditConversionProfile {
	id?: string | null;
	taskSignature: string;
	executionProfileId: string;
	executionProviderKind: string;
	nativeUnit: string;
	sampleCount: number;
	completedSampleCount: number;
	interruptedSampleCount?: number;
	nativeUnitsPerCreditP50: number | null;
	nativeUnitsPerCreditP90: number | null;
	creditsPerNativeUnitP50: number | null;
	creditsPerNativeUnitP90: number | null;
	actualCreditsP50: number | null;
	actualCreditsP90: number | null;
	confidence: 'low' | 'medium' | 'high' | string;
	formulaVersion: string;
	metadata?: Record<string, unknown>;
	createdAt?: string | null;
	updatedAt: string;
}

export interface DerivedCapacityAvailability {
	executionProviderId: string;
	capacityProviderId: string | null;
	executionProviderKind: string;
	nativeUnit: string;
	scope: string | null;
	configuredNativeLimit: number | null;
	observedNativeRemaining: number | null;
	nativeRemainingSource: 'observation' | 'configured_limit' | 'unknown';
	activeReservedNativeAmount: number;
	activeConsumedNativeAmount: number;
	reserveBufferPercent: number;
	reserveBufferNativeAmount: number;
	availableNativeAmount: number;
	nativeUnitsPerCredit: number | null;
	conversionProfileId?: string | null;
	conversionTaskSignature?: string | null;
	conversionConfidence?: string | null;
	derivedAvailableCredits: number | null;
	confidence: 'low' | 'medium' | 'high' | string;
	resetAt?: string | null;
	accountingWindowStartAt?: string | null;
	accountingWindowEndAt?: string | null;
	accountingWindowSource?: 'observation' | 'configured_reset' | 'unknown';
	reasons: string[];
	metadata?: Record<string, unknown>;
}

export interface DerivedCapacitySummary {
	entries: DerivedCapacityAvailability[];
	totalDerivedAvailableCredits?: number | null;
	derivedEntryCount?: number;
	learningEntryCount?: number;
	availableNativeByUnit?: Record<string, number>;
	providers?: Array<{
		capacityProviderId: string;
		entries?: DerivedCapacityAvailability[];
		totalDerivedAvailableCredits?: number | null;
		derivedEntryCount?: number;
		learningEntryCount?: number;
		availableNativeByUnit?: Record<string, number>;
		[key: string]: unknown;
	}>;
	[key: string]: unknown;
}

export interface NativeReservationDebitAggregate {
	activeReservedNativeAmount: number;
	activeConsumedNativeAmount: number;
}

export interface DerivedCapacityInput {
	executionProvider: CapacityExecutionProvider;
	nativeLimit?: CapacityExecutionProviderNativeLimit | null;
	latestObservation?: CapacityExecutionProviderObservation | null;
	activeReservations?: CapacityReservation[];
	reservationDebits?: NativeReservationDebitAggregate | null;
	conversionProfile?: CreditConversionProfile | null;
	scope?: string | null;
	nativeUnit?: string | null;
	now?: Date | string | null;
}

export interface ApprovalRequest {
	id: string;
	teamId: string;
	projectId: string;
	workDayId: string | null;
	taskId: string | null;
	kind: string;
	state: CapacityApprovalState;
	severity: 'low' | 'medium' | 'high';
	requestedByType: 'agent' | 'scheduler' | 'worker' | 'service' | 'user';
	requestedById: string | null;
	title: string;
	summary: string;
	options: Record<string, unknown>[];
	recommendation: Record<string, unknown>;
	policySnapshot: Record<string, unknown>;
	expiresAt: string | null;
	decidedByType: string | null;
	decidedById: string | null;
	decidedAt: string | null;
	decision: Record<string, unknown> | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ListApprovalRequestsRequest {
	projectId?: string | null;
	teamId?: string | null;
	state?: CapacityApprovalState | string | Array<CapacityApprovalState | string> | null;
	limit?: number;
}

export interface DecideApprovalRequestRequest {
	state: CapacityApprovalState | string;
	optionId?: string | null;
	note?: string | null;
	decision?: Record<string, unknown> | null;
	decidedByType?: string | null;
	decidedById?: string | null;
}

export interface UpsertTeamInboxItemRequest {
	id?: string;
	teamId: string;
	projectId?: string | null;
	kind: string;
	state: string;
	title: string;
	summary?: string | null;
	href?: string | null;
	itemKey?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface ProjectCapacityDiagnostics {
	projectId: string;
	teamId: string;
	environment: ProjectEnvironmentName | 'local';
	providers: CapacityProviderMembershipView[];
	executionProviders: CapacityExecutionProvider[];
	grants: import('./agent-capacity/allocation.ts').CapacityGrantV2[];
	activeReservations: CapacityReservation[];
	derivedCapacity?: DerivedCapacitySummary | null;
	remaining: {
		dailyCredits: number | null;
		monthlyCredits: number | null;
	};
}

export interface ProjectCapabilityGrant {
	id: string;
	projectId: string;
	namespace: SdkDispatchNamespace;
	operation: string;
	executionClass: SdkDispatchExecutionClass;
	allowedTargets: SdkDispatchTarget[];
	defaultDispatchMode: SdkDispatchPolicy;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface RemoteJobError {
	code?: string | null;
	message: string;
}

export interface RemoteJob {
	id: string;
	projectId: string;
	namespace: SdkDispatchNamespace;
	operation: string;
	status: RemoteJobStatus;
	preferredMode: SdkDispatchPolicy;
	selectedTarget: SdkDispatchTarget;
	input: Record<string, unknown>;
	output?: unknown;
	error?: RemoteJobError | null;
	requestedByType: RemoteJobRequestedByType;
	requestedById: string | null;
	assignedRunnerId: string | null;
	idempotencyKey: string | null;
	capability?: SdkDispatchCapability | null;
	pollUrl?: string | null;
	streamUrl?: string | null;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	cancelledAt: string | null;
}

export interface RemoteJobEvent {
	id: string;
	jobId: string;
	seq: number;
	kind: string;
	data?: Record<string, unknown>;
	createdAt: string;
}

export interface SdkDispatchRequest {
	namespace?: SdkDispatchNamespace;
	operation: string;
	input?: Record<string, unknown>;
	preferredMode?: SdkDispatchPolicy;
	idempotencyKey?: string;
}

export interface SdkDispatchInlineResult {
	ok: true;
	mode: 'inline';
	namespace: SdkDispatchNamespace;
	operation: string;
	target: SdkDispatchTarget;
	capability: SdkDispatchCapability;
	payload: unknown;
}

export interface SdkDispatchJobResult {
	ok: true;
	mode: 'job';
	namespace: SdkDispatchNamespace;
	operation: string;
	target: SdkDispatchTarget;
	capability: SdkDispatchCapability;
	job: RemoteJob;
}

export type SdkDispatchResult = SdkDispatchInlineResult | SdkDispatchJobResult;

export type SdkDispatchCredentialSource =
	| {
			type: 'bearer';
			token: string;
	  }
	| {
			type: 'resolver';
			resolveToken: () => Promise<string | null> | string | null;
	  };

export interface SdkDispatchConfig {
	projectId: string;
	marketBaseUrl: string;
	policy?: SdkDispatchPolicy;
	credentialSource?: SdkDispatchCredentialSource;
	fetchImpl?: typeof fetch;
}

export type SdkFilterOperator =
	| 'eq'
	| 'in'
	| 'contains'
	| 'prefix'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte'
	| 'updated_since'
	| 'related_to';

export type TreeseedSchemaVersion = number;

export type TreeseedRuntimeRecordType =
	| 'subscription'
	| 'contact_submission'
	| 'agent_run'
	| 'message'
	| 'agent_cursor'
	| 'content_lease';

export interface TreeseedRecordEnvelope<TPayload, TMeta = Record<string, unknown>> {
	recordType: TreeseedRuntimeRecordType;
	schemaVersion: TreeseedSchemaVersion;
	status: string;
	payload: TPayload;
	meta: TMeta;
}

export interface TreeseedSubscriptionPayload {
	email: string;
	name: string | null;
	source: string;
	consentAt: string | null;
	ipHash: string;
}

export interface TreeseedSubscriptionMeta {
	legacyId?: number;
}

export interface TreeseedContactSubmissionPayload {
	name: string;
	email: string;
	organization: string | null;
	contactType: string;
	subject: string;
	message: string;
	userAgent: string;
	ipHash: string;
}

export interface TreeseedContactSubmissionMeta {
	source?: string;
}

export interface TreeseedAgentRunPayload {
	triggerSource: string;
	handlerKind?: string | null;
	triggerKind?: string | null;
	selectedItemKey: string | null;
	selectedMessageId: number | null;
	claimedMessageId?: number | null;
	branchName: string | null;
	prUrl: string | null;
	summary: string | null;
	error: string | null;
	errorCategory?: string | null;
	commitSha?: string | null;
	changedPaths?: string[];
	finishedAt: string | null;
}

export interface TreeseedAgentRunMeta {
	runId: string;
	agentSlug: string;
}

export interface TreeseedMessagePayload {
	body: Record<string, unknown>;
}

export interface TreeseedMessageMeta {
	actor?: string;
	trace?: Record<string, unknown>;
}

export interface TreeseedCursorPayload {
	cursorValue: string;
}

export interface TreeseedCursorMeta {
	updatedBy?: string;
}

export interface TreeseedLeasePayload {
	token: string;
}

export interface TreeseedLeaseMeta {
	actor?: string;
}

export interface SdkFilterCondition {
	field: string;
	op: SdkFilterOperator;
	value: unknown;
}

export interface SdkSortSpec {
	field: string;
	direction?: 'asc' | 'desc';
}

export interface SdkJsonEnvelope<TPayload> {
	ok: boolean;
	model: SdkModelName;
	operation: SdkOperation;
	payload: TPayload;
	meta?: Record<string, unknown>;
}

export interface SdkMessageEntity {
	[key: string]: unknown;
	id: number;
	recordType?: TreeseedRuntimeRecordType;
	schemaVersion?: TreeseedSchemaVersion;
	type: string;
	status: string;
	payloadJson: string;
	metaJson?: string;
	relatedModel: string | null;
	relatedId: string | null;
	priority: number;
	availableAt: string;
	claimedBy: string | null;
	claimedAt: string | null;
	leaseExpiresAt: string | null;
	attempts: number;
	maxAttempts: number;
	createdAt: string;
	updatedAt: string;
}

export interface SdkRunEntity {
	[key: string]: unknown;
	runId: string;
	recordType?: TreeseedRuntimeRecordType;
	schemaVersion?: TreeseedSchemaVersion;
	agentSlug: string;
	handlerKind?: string | null;
	triggerKind?: string | null;
	triggerSource: string;
	claimedMessageId?: number | null;
	status: string;
	selectedItemKey: string | null;
	selectedMessageId: number | null;
	branchName: string | null;
	commitSha?: string | null;
	changedPaths?: string[];
	prUrl: string | null;
	summary: string | null;
	error: string | null;
	errorCategory?: string | null;
	startedAt: string;
	finishedAt: string | null;
}

export interface SdkCursorEntity {
	[key: string]: unknown;
	recordType?: TreeseedRuntimeRecordType;
	schemaVersion?: TreeseedSchemaVersion;
	agentSlug: string;
	cursorKey: string;
	cursorValue: string;
	updatedAt: string | null;
}

export interface SdkLeaseEntity {
	[key: string]: unknown;
	recordType?: TreeseedRuntimeRecordType;
	schemaVersion?: TreeseedSchemaVersion;
	model: string;
	itemKey: string;
	claimedBy: string;
	claimedAt: string;
	leaseExpiresAt: string;
	token: string;
}

export interface SdkSubscriptionEntity {
	[key: string]: unknown;
	id?: number;
	recordType?: TreeseedRuntimeRecordType;
	schemaVersion?: TreeseedSchemaVersion;
	email: string;
	name?: string | null;
	status: string;
	source?: string;
	metaJson?: string;
	consent_at?: string;
	created_at?: string;
	updated_at?: string;
	ip_hash?: string;
}

export interface SdkAgentSpec {
	[key: string]: unknown;
	id: string;
	slug: string;
	title?: string;
	body: string;
	frontmatter: Record<string, unknown>;
}

export interface SdkContentEntry {
	id: string;
	slug: string;
	model: SdkModelName;
	title?: string;
	path: string;
	body: string;
	frontmatter: Record<string, unknown>;
	updatedAt: string | null;
	createdAt: string | null;
}

export interface SdkSearchRequest {
	model: SdkModelName;
	filters?: SdkFilterCondition[];
	sort?: SdkSortSpec[];
	limit?: number;
	cursor?: string | null;
}

export interface SdkGetRequest {
	model: SdkModelName;
	id?: string;
	slug?: string;
	key?: string;
}

export interface SdkFollowRequest {
	model: SdkModelName;
	since: string;
	filters?: SdkFilterCondition[];
	timeoutSeconds?: number;
}

export interface SdkPickRequest {
	model: SdkModelName;
	strategy?: SdkPickStrategy;
	filters?: SdkFilterCondition[];
	leaseSeconds: number;
	workerId: string;
}

export interface SdkMutationRequest {
	model: SdkModelName;
	data: Record<string, unknown>;
	actor: string;
}

export interface SdkUpdateRequest extends SdkMutationRequest {
	id?: string;
	slug?: string;
	key?: string;
	expectedVersion?: string;
}

export interface SdkModelFieldBinding extends TreeseedFieldAliasBinding {
	aliases?: string[];
	contentKeys?: string[];
	dbColumns?: string[];
	payloadPaths?: string[];
	writeContentKey?: string;
	writeDbColumn?: string;
	filterable?: boolean;
	sortable?: boolean;
	comparableAs?: SdkComparableAs;
	normalize?: (value: unknown) => unknown;
}

export interface SdkModelDefinition {
	name: SdkModelName;
	aliases: string[];
	storage: SdkStorageBackend;
	operations: SdkOperation[];
	fields: Record<string, SdkModelFieldBinding>;
	filterableFields: string[];
	sortableFields: string[];
	pickField: string;
	contentCollection?: string;
	contentDir?: string;
	graph?: SdkGraphModelConfig;
}

export type SdkModelRegistry = Record<string, SdkModelDefinition>;

export type SdkGraphNodeType =
	| 'File'
	| 'Section'
	| 'Agent'
	| 'Objective'
	| 'Question'
	| 'Note'
	| 'Proposal'
	| 'Decision'
	| 'Knowledge'
	| 'Book'
	| 'Page'
	| 'Person'
	| 'Tag'
	| 'Series'
	| 'Reference'
	| 'Entity';

export type SdkGraphEdgeType =
	| 'HAS_SECTION'
	| 'BELONGS_TO_FILE'
	| 'PARENT_SECTION'
	| 'CHILD_SECTION'
	| 'NEXT_SECTION'
	| 'PREV_SECTION'
	| 'LINKS_TO'
	| 'REFERENCES'
	| 'MENTIONS'
	| 'HAS_TAG'
	| 'IN_SERIES'
	| 'SAME_DIRECTORY'
	| 'SAME_COLLECTION'
	| 'DEFINES'
	| 'DEFINED_BY'
	| 'RELATES_TO'
	| 'DEPENDS_ON'
	| 'IMPLEMENTS'
	| 'EXTENDS'
	| 'SUPERSEDES'
	| 'BELONGS_TO'
	| 'ABOUT'
	| 'USED_BY'
	| 'GENERATED_FROM';

export interface SdkGraphReferenceFieldConfig {
	field: string;
	edgeType?: Exclude<SdkGraphEdgeType, 'HAS_SECTION' | 'BELONGS_TO_FILE' | 'PARENT_SECTION' | 'CHILD_SECTION' | 'NEXT_SECTION' | 'PREV_SECTION' | 'LINKS_TO' | 'MENTIONS' | 'SAME_DIRECTORY' | 'SAME_COLLECTION' | 'DEFINES' | 'DEFINED_BY'>;
	targetModels?: string[];
	multiple?: boolean;
}

export interface SdkGraphModelConfig {
	entityType?: SdkGraphNodeType;
	referenceFields?: SdkGraphReferenceFieldConfig[];
	tagField?: string;
	seriesField?: string;
	titleField?: string;
	enableSections?: boolean;
}

export interface SdkGraphRefreshRequest {
	paths?: string[];
}

export interface SdkGraphQueryOptions {
	limit?: number;
	models?: string[];
	nodeTypes?: SdkGraphNodeType[];
	edgeTypes?: SdkGraphEdgeType[];
	direction?: 'outgoing' | 'incoming' | 'both';
	depth?: number;
	scoreThreshold?: number;
	maxNodes?: number;
	cycleDetection?: boolean;
	edgeWeights?: Partial<Record<SdkGraphEdgeType, number>>;
}

export interface SdkGraphSearchOptions extends SdkGraphQueryOptions {
	prefix?: boolean;
	fuzzy?: number | boolean;
}

export interface SdkResolveReferenceOptions {
	fromNodeId?: string;
	fromPath?: string;
	models?: string[];
}

export interface SdkGraphNode {
	id: string;
	nodeType: SdkGraphNodeType;
	sourceModel?: string;
	entityType?: string;
	ownerFileId?: string;
	path?: string;
	slug?: string;
	title?: string;
	heading?: string | null;
	headingPath?: string | null;
	level?: number | null;
	text?: string;
	tags?: string[];
	series?: string | null;
	fileId?: string;
	entityId?: string;
	status?: string | null;
	canonical?: boolean;
	canonicalId?: string | null;
	version?: string | null;
	domain?: string | null;
	audience?: string[];
	updatedAt?: string | null;
	data?: Record<string, unknown>;
}

export interface SdkGraphEdge {
	id: string;
	type: SdkGraphEdgeType;
	sourceId: string;
	targetId: string;
	ownerFileId?: string;
	data?: Record<string, unknown>;
}

export interface SdkGraphSearchResult {
	node: SdkGraphNode;
	score: number;
	reason: string;
	highlights?: string[];
	context?: Record<string, unknown>;
}

export interface SdkGraphRankingDiagnostics {
	providerId: string;
	lexicalScore: number;
	graphScore: number;
	priorScore: number;
	canonicalityScore: number;
	freshnessScore: number;
	stageScore: number;
	finalScore: number;
}

export interface SdkGraphTraversalResult {
	seedId: string;
	nodes: SdkGraphNode[];
	edges: SdkGraphEdge[];
}

export interface SdkGraphSeed {
	id: string;
	kind: 'id' | 'path' | 'query' | 'tag' | 'type';
	value: string;
	scope?: 'files' | 'sections' | 'entities';
}

export type SdkGraphQueryStage = 'plan' | 'implement' | 'research' | 'debug' | 'review';
export type SdkGraphQueryView = 'list' | 'brief' | 'full' | 'map';
export type SdkGraphDslRelation =
	| 'related'
	| 'depends_on'
	| 'implements'
	| 'references'
	| 'parent'
	| 'child'
	| 'supersedes';

export interface SdkGraphWhereFilter {
	field: 'type' | 'status' | 'audience' | 'tag' | 'domain';
	op: 'eq' | 'in';
	value: string | string[];
}

export interface SdkGraphSeedResolution {
	seeds: SdkGraphSeed[];
	matches: SdkGraphSearchResult[];
	resolvedNodeIds: string[];
}

export interface SdkGraphQueryRequest {
	seedIds?: string[];
	seeds?: SdkGraphSeed[];
	query?: string;
	scope?: 'files' | 'sections' | 'entities';
	stage?: SdkGraphQueryStage;
	scopePaths?: string[];
	where?: SdkGraphWhereFilter[];
	relations?: SdkGraphDslRelation[];
	view?: SdkGraphQueryView;
	options?: SdkGraphQueryOptions;
}

export interface SdkGraphQueryNodeResult {
	node: SdkGraphNode;
	score: number;
	depth: number;
	reasons: string[];
	diagnostics?: SdkGraphRankingDiagnostics;
}

export interface SdkGraphQueryResult {
	seedIds: string[];
	nodes: SdkGraphQueryNodeResult[];
	edges: SdkGraphEdge[];
	providerId?: string;
	diagnostics?: Record<string, unknown>;
}

export interface SdkContextPackNode {
	node: SdkGraphNode;
	score: number;
	depth: number;
	text: string;
	tokenEstimate: number;
	reasons: string[];
	provenance: {
		seedIds: string[];
		viaEdgeTypes: SdkGraphEdgeType[];
	};
}

export interface SdkGraphRankingBuildInput {
	nodes: SdkGraphNode[];
	edges: SdkGraphEdge[];
}

export interface SdkGraphRankingSearchRequest {
	query: string;
	scope: 'files' | 'sections' | 'entities' | 'all';
	options?: SdkGraphSearchOptions;
	request?: SdkGraphQueryRequest;
}

export interface SdkGraphRankingNodeResult {
	nodeId: string;
	score: number;
	depth: number;
	reasons: string[];
	seedIds: string[];
	viaEdgeTypes: SdkGraphEdgeType[];
	diagnostics?: SdkGraphRankingDiagnostics;
}

export interface SdkGraphRankingQueryRequest {
	request: SdkGraphQueryRequest;
	seedIds: string[];
	seedMatches?: SdkGraphSearchResult[];
	allowedNodeIds?: string[];
	allowedEdgeTypes?: SdkGraphEdgeType[];
}

export interface SdkGraphRankingQueryResult {
	providerId: string;
	nodes: SdkGraphRankingNodeResult[];
	edgeIds: string[];
	diagnostics?: Record<string, unknown>;
}

export interface SdkGraphRankingIndex {
	search(request: SdkGraphRankingSearchRequest): SdkGraphSearchResult[];
	rankQuery(request: SdkGraphRankingQueryRequest): SdkGraphRankingQueryResult;
	serialize?(): Record<string, unknown>;
}

export interface SdkGraphRankingProvider {
	id: string;
	capabilities?: string[];
	buildIndex(input: SdkGraphRankingBuildInput): SdkGraphRankingIndex;
}

export interface SdkContextPack {
	seedIds: string[];
	totalTokenEstimate: number;
	includedNodeIds: string[];
	nodes: SdkContextPackNode[];
	edges: SdkGraphEdge[];
}

export interface SdkContextPackRequest extends SdkGraphQueryRequest {
	budget?: {
		maxNodes?: number;
		maxTokens?: number;
		includeMode?: 'files' | 'sections' | 'mixed';
	};
}

export interface SdkGraphDslParseResult {
	ok: boolean;
	query: SdkContextPackRequest | null;
	errors: string[];
}

export interface SdkGraphPathExplanation {
	fromId: string;
	toId: string;
	nodes: SdkGraphNode[];
	edges: SdkGraphEdge[];
}

export interface SdkGraphRefreshPayload {
	ready: boolean;
	snapshotRoot: string;
	changed: {
		added: string[];
		modified: string[];
		removed: string[];
	};
	metrics: Record<string, unknown>;
}

export interface SdkCreateMessageRequest {
	type: string;
	payload: Record<string, unknown> | string;
	relatedModel?: string | null;
	relatedId?: string | null;
	priority?: number;
	maxAttempts?: number;
	actor: string;
}

export interface SdkClaimMessageRequest {
	workerId: string;
	messageTypes?: string[];
	leaseSeconds: number;
}

export interface SdkAckMessageRequest {
	id: number;
	status: 'completed' | 'failed' | 'dead_letter' | 'pending' | 'claimed';
}

export interface SdkRecordRunRequest {
	run: Record<string, unknown>;
}

export interface SdkCursorRequest {
	agentSlug: string;
	cursorKey: string;
	cursorValue: string;
}

export interface SdkGetCursorRequest {
	agentSlug: string;
	cursorKey: string;
}

export interface SdkLeaseReleaseRequest {
	model: string;
	itemKey: string;
	leaseToken?: string | null;
}

export interface UpsertProjectHostingRequest {
	kind: TreeseedHostingKind;
	registration?: TreeseedHostingRegistration;
	marketBaseUrl?: string | null;
	sourceRepoOwner?: string | null;
	sourceRepoName?: string | null;
	sourceRepoUrl?: string | null;
	sourceRepoWorkflowPath?: string | null;
	projectApiBaseUrl?: string | null;
	executionOwner?: ProjectExecutionOwner | null;
	metadata?: Record<string, unknown> | null;
}

export interface UpsertProjectEnvironmentRequest {
	deploymentProfile?: TreeseedHostingKind;
	baseUrl?: string | null;
	cloudflareAccountId?: string | null;
	pagesProjectName?: string | null;
	workerName?: string | null;
	r2BucketName?: string | null;
	d1DatabaseName?: string | null;
	queueName?: string | null;
	railwayProjectName?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface UpsertProjectInfrastructureResourceRequest {
	id?: string;
	environment: ProjectEnvironmentName;
	provider: ProjectInfrastructureResourceProvider;
	resourceKind: ProjectInfrastructureResourceKind;
	logicalName: string;
	locator?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface CreateProjectDeploymentRequest {
	id?: string;
	environment: ProjectEnvironmentName;
	deploymentKind: ProjectDeploymentKind;
	status?: ProjectDeploymentStatus;
	action?: ProjectWebDeploymentAction | string;
	platformOperationId?: string | null;
	retryOfDeploymentId?: string | null;
	resumedFromDeploymentId?: string | null;
	idempotencyKey?: string | null;
	requestedByUserId?: string | null;
	sourceRef?: string | null;
	releaseTag?: string | null;
	commitSha?: string | null;
	triggeredByType?: string | null;
	triggeredById?: string | null;
	repository?: Record<string, unknown> | null;
	externalWorkflow?: Record<string, unknown> | null;
	target?: Record<string, unknown> | null;
	monitor?: Record<string, unknown> | null;
	summary?: string | null;
	error?: Record<string, unknown> | null;
	metadata?: Record<string, unknown> | null;
	startedAt?: string | null;
	finishedAt?: string | null;
	completedAt?: string | null;
}


export interface CatalogItemFilters {
	kind?: string;
	teamId?: string;
	slug?: string;
}

export interface UpsertCatalogItemRequest {
	id?: string;
	kind: string;
	slug: string;
	title: string;
	summary?: string | null;
	visibility?: CatalogItem['visibility'];
	listingEnabled?: boolean;
	offerMode?: CatalogItemOfferMode;
	manifestKey?: string | null;
	artifactKey?: string | null;
	searchText?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface UpsertCatalogArtifactVersionRequest {
	id?: string;
	kind: string;
	version: string;
	contentKey: string;
	manifestKey?: string | null;
	metadata?: Record<string, unknown> | null;
	publishedAt?: string | null;
}

export interface UpsertTeamStorageLocatorRequest {
	bucketName: string;
	manifestKeyTemplate: string;
	previewRootTemplate: string;
	publicBaseUrl?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface CreateCapacityProviderRequest {
	name: string;
	launchMode: 'self_hosted' | 'managed_market_host' | 'connected_host';
}

export interface RenameCapacityProviderRequest {
	name: string;
}

export interface CreateApprovalRequestRequest {
	id?: string;
	teamId: string;
	projectId: string;
	workDayId?: string | null;
	taskId?: string | null;
	kind: string;
	severity?: 'low' | 'medium' | 'high';
	requestedByType?: ApprovalRequest['requestedByType'];
	requestedById?: string | null;
	title: string;
	summary: string;
	options?: Record<string, unknown>[];
	recommendation?: Record<string, unknown> | null;
	policySnapshot?: Record<string, unknown> | null;
	expiresAt?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface SdkFollowResult<TItem> {
	items: TItem[];
	since: string;
}

export interface SdkPickResult<TItem> {
	item: TItem | null;
	leaseToken: string | null;
}

export type SdkTemplateCatalogStatus = 'draft' | 'live' | 'archived';
export type SdkTemplateCategory = 'starter' | 'example' | 'fixture' | 'reference-app';

export interface SdkTemplateCatalogPublisher {
	id: string;
	name: string;
	url?: string;
}

export interface SdkTemplateCatalogGitSource {
	kind: 'git';
	repoUrl: string;
	directory: string;
	ref: string;
	integrity?: string;
}

export interface SdkTemplateCatalogR2Source {
	kind: 'r2';
	bucket?: string;
	objectKey: string;
	version: string;
	publicUrl?: string;
	integrity?: string;
}

export type SdkTemplateCatalogSource = SdkTemplateCatalogGitSource | SdkTemplateCatalogR2Source;

export interface SdkTemplateCatalogEntry {
	id: string;
	displayName: string;
	description: string;
	summary: string;
	status: SdkTemplateCatalogStatus;
	featured?: boolean;
	category: SdkTemplateCategory;
	audience?: string[];
	tags?: string[];
	publisher: SdkTemplateCatalogPublisher;
	publisherVerified?: boolean;
	templateVersion: string;
	templateApiVersion: number;
	minCliVersion: string;
	minCoreVersion?: string;
	fulfillment: {
		mode?: 'packaged' | 'git' | 'r2';
		source: SdkTemplateCatalogSource;
		hooksPolicy: 'builtin_only' | 'trusted_only' | 'disabled';
		supportsReconcile: boolean;
	};
	offer?: {
		priceModel?: CommerceOfferMode;
		license?: string;
		support?: string;
	};
	relatedBooks?: string[];
	relatedKnowledge?: string[];
	relatedObjectives?: string[];
	launchRequirements?: TemplateLaunchRequirements;
}

export interface SdkTemplateCatalogResponse {
	items: SdkTemplateCatalogEntry[];
	meta?: Record<string, unknown>;
}
