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

export const HOSTING_KINDS = ['treeseed_control_plane', 'hosted_project', 'self_hosted_project'] as const;

export const HOSTING_REGISTRATIONS = ['optional', 'none'] as const;

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

export const DEFAULT_STARTER_TEMPLATE_ID = 'research' as const;

export const TEMPLATE_ID_ALIASES = {} as const;

export function normalizeTemplateId(templateId: string | null | undefined) {
	const trimmed = String(templateId ?? '').trim();
	return (TEMPLATE_ID_ALIASES as Record<string, string>)[trimmed] ?? trimmed;
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

export type HostingKind = (typeof HOSTING_KINDS)[number];

export type HostingRegistration = (typeof HOSTING_REGISTRATIONS)[number];

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
