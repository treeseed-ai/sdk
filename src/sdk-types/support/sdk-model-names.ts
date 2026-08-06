

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
	'discussion',
	'discussion_message',
	'discussion_event',
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

export const REMOTE_JOB_STATUSES = ['pending', 'claimed', 'running', 'completed', 'failed', 'cancelled'] as const;

export const PROJECT_ENVIRONMENT_NAMES = ['local', 'staging', 'prod'] as const;

export const DEFAULT_STARTER_TEMPLATE_ID = 'research' as const;

export const TEMPLATE_ID_ALIASES = {} as const;

export function normalizeTemplateId(templateId: string | null | undefined) {
	const trimmed = String(templateId ?? '').trim();
	return (TEMPLATE_ID_ALIASES as Record<string, string>)[trimmed] ?? trimmed;
}

export const TREEDX_INSTANCE_KINDS = ['managed_private', 'managed_public_federation', 'self_hosted'] as const;

export const TREEDX_INSTANCE_STATUSES = ['pending', 'active', 'degraded', 'offline', 'disabled'] as const;

export const TREEDX_DEPLOYMENT_PROVIDERS = ['railway', 'self_hosted', 'public_federation'] as const;

export const TREEDX_MIRROR_DIRECTIONS = ['pull', 'push', 'bidirectional'] as const;

export const TREEDX_MIRROR_STATUSES = ['pending', 'active', 'syncing', 'degraded', 'disabled'] as const;

export const TREEDX_SHARE_SCOPES = ['team', 'library', 'public_federation'] as const;

export const TREEDX_SHARE_STATUSES = ['active', 'revoked', 'expired'] as const;

export const PROJECT_REPOSITORY_ACCESS_MODES = ['treedx', 'filesystem'] as const;

export const PROJECT_REPOSITORY_TOPOLOGY_PARTS = ['contentRepository', 'siteRepository', 'projectRepository'] as const;

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

export type RemoteJobStatus = (typeof REMOTE_JOB_STATUSES)[number];

export type ProjectEnvironmentName = (typeof PROJECT_ENVIRONMENT_NAMES)[number];

export type RemoteJobRequestedByType = 'user' | 'team_api_key' | 'service' | 'runner' | 'system';

export type TreeDxInstanceKind = (typeof TREEDX_INSTANCE_KINDS)[number];

export type TreeDxInstanceStatus = (typeof TREEDX_INSTANCE_STATUSES)[number];

export type TreeDxDeploymentProvider = (typeof TREEDX_DEPLOYMENT_PROVIDERS)[number];

export type TreeDxMirrorDirection = (typeof TREEDX_MIRROR_DIRECTIONS)[number];

export type TreeDxMirrorStatus = (typeof TREEDX_MIRROR_STATUSES)[number];

export type TreeDxShareScope = (typeof TREEDX_SHARE_SCOPES)[number];

export type TreeDxShareStatus = (typeof TREEDX_SHARE_STATUSES)[number];

export type ProjectRepositoryAccessMode = (typeof PROJECT_REPOSITORY_ACCESS_MODES)[number];

export type ProjectRepositoryTopologyPart = (typeof PROJECT_REPOSITORY_TOPOLOGY_PARTS)[number];
