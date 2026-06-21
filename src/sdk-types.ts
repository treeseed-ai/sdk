import type { TreeseedFieldAliasBinding } from './field-aliases.ts';

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
	'work_day',
	'task',
	'task_event',
	'task_output',
	'graph_run',
	'report',
	'approval_request',
	'team_inbox_item',
	'workday_manager_lease',
	'worker_runner',
	'repository_claim',
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
export const AGENT_POOL_STATUSES = ['pending', 'active', 'degraded', 'offline'] as const;
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
export type AgentPoolStatus = (typeof AGENT_POOL_STATUSES)[number];
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
	dryRun?: boolean;
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

export type CatalogItemOfferMode =
	| 'free'
	| 'paid'
	| 'contact'
	| 'one_time_current_version'
	| 'subscription_updates'
	| 'private';

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
	dryRun?: boolean;
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

export interface AgentPoolAutoscalePolicy {
	minWorkers: number;
	maxWorkers: number;
	targetQueueDepth: number;
	cooldownSeconds: number;
}

export interface AgentPool {
	id: string;
	projectId: string;
	teamId: string;
	environment: ProjectEnvironmentName;
	name: string;
	registrationIdentity: string | null;
	serviceBaseUrl: string | null;
	status: AgentPoolStatus;
	autoscale: AgentPoolAutoscalePolicy;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface AgentPoolRegistration {
	id: string;
	poolId: string;
	projectId: string;
	runnerId: string | null;
	managerId: string | null;
	serviceName: string | null;
	heartbeatAt: string;
	desiredWorkers: number | null;
	observedQueueDepth: number | null;
	observedActiveLeases: number | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface AgentPoolScaleDecision {
	id: string;
	poolId: string;
	projectId: string;
	environment: ProjectEnvironmentName;
	desiredWorkers: number;
	observedQueueDepth: number;
	observedActiveLeases: number;
	workDayId: string | null;
	reason: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface WorkdayWindow {
	days: number[];
	startTime: string;
	endTime: string;
}

export interface WorkdaySchedule {
	timezone: string;
	windows: WorkdayWindow[];
}

export interface TaskCreditWeight {
	id?: string;
	taskType?: string | null;
	agentId?: string | null;
	handler?: string | null;
	credits: number;
}

export interface TaskCreditBudget {
	dailyLimit: number;
	used: number;
	remaining: number;
	maxQueuedTasks: number;
	maxQueuedCredits: number;
}

export interface WorkdayPolicy {
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	schedule: WorkdaySchedule;
	enabled: boolean;
	startCron: string;
	durationMinutes: number;
	maxRunners: number;
	maxWorkersPerRunner: number;
	dailyCreditBudget: number;
	closeoutGraceMinutes: number;
	dailyTaskCreditBudget: number;
	maxQueuedTasks: number;
	maxQueuedCredits: number;
	autoscale: AgentPoolAutoscalePolicy;
	creditWeights: TaskCreditWeight[];
	metadata?: Record<string, unknown>;
}

export type WorkdayRequestType = 'one_off_run' | 'early_close' | 'pause' | 'retry_open';
export type WorkdayRequestState = 'pending' | 'applied' | 'rejected' | 'cancelled';

export interface WorkdayRequest {
	id: string;
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	type: WorkdayRequestType;
	state: WorkdayRequestState;
	workDayId: string | null;
	requestedBy: string | null;
	reason: string | null;
	payload: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface WorkdayManagerLease {
	id: string;
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	workDayId: string | null;
	managerId: string;
	state: 'active' | 'released' | 'stale';
	heartbeatAt: string;
	expiresAt: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export type WorkerRunnerState = 'active' | 'idle' | 'offline' | 'sleeping' | 'waking' | 'draining' | 'failed';

export interface WorkerRunner {
	id: string;
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	runnerId: string;
	runnerServiceName: string;
	volumeIdentity: string;
	state: WorkerRunnerState;
	maxLocalWorkers: number;
	activeLocalWorkers: number;
	availableCapacity: number;
	lastHeartbeatAt: string | null;
	claimedRepositoryIds: string[];
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface RepositoryClaim {
	id: string;
	projectId: string;
	repositoryId: string;
	runnerId: string;
	runnerServiceName: string;
	volumeIdentity: string;
	lastSeenCommit: string | null;
	lastTaskAt: string | null;
	claimState: 'active' | 'stale' | 'released';
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface PrioritySnapshotItem {
	model: string;
	id: string;
	slug?: string | null;
	title?: string | null;
	priority: number;
	estimatedCredits: number;
	reasons: string[];
	metadata?: Record<string, unknown>;
}

export interface PrioritySnapshot {
	id: string;
	projectId: string;
	workDayId: string | null;
	generatedAt: string;
	items: PrioritySnapshotItem[];
	metadata?: Record<string, unknown>;
}

export interface PriorityOverride {
	id: string;
	projectId: string;
	model: string;
	subjectId: string;
	priority: number;
	estimatedCredits: number | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface TaskCreditLedgerEntry {
	id: string;
	projectId: string;
	workDayId: string;
	taskId: string | null;
	phase:
		| 'seed'
		| 'settle'
		| 'refund'
		| 'grant'
		| 'reserve'
		| 'consume'
		| 'release'
		| 'adjustment'
		| 'grant_created'
		| 'reservation_created'
		| 'reservation_released'
		| 'task_started'
		| 'task_completed_estimate_settlement'
		| 'task_completed_actual_settlement'
		| 'task_failed_refund'
		| 'manual_adjustment'
		| 'monthly_rollover'
		| 'overrun_hold';
	credits: number;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export type CapacityProviderKind = 'treeseed_managed' | 'team_owned' | 'external' | 'hybrid';
export type CapacityProviderStatus =
	| 'pending'
	| 'online'
	| 'offline'
	| 'credential_required'
	| 'registering'
	| 'active'
	| 'degraded'
	| 'draining'
	| 'paused'
	| 'configuration_required'
	| 'rotation_required'
	| 'disabled'
	| 'failed';
export type CapacityProviderBillingScope = 'treeseed' | 'team' | 'external';
export type CapacityBusinessModel = 'subscription_quota' | 'token_metered' | 'hybrid_usage_based' | 'infrastructure_runtime' | 'custom';
export type CapacityLaneUnit = 'treeseed_credit' | 'quota_minute' | 'token_usd' | 'github_ai_credit' | 'worker_second' | 'request' | 'custom';
export type CapacityScarcityLevel = 'low' | 'medium' | 'high';
export type CapacityGrantScope = 'team' | 'project' | 'workday' | 'overflow_pool';
export type CapacityGrantState = 'active' | 'paused' | 'expired' | 'disabled';
export type CapacityOverflowPolicy =
	| 'deny'
	| 'hard_grant'
	| 'soft_grant'
	| 'weighted_fair_share'
	| 'approval_required'
	| 'fallback_lane'
	| 'platform_subsidy';
export type CapacityReservationState =
	| 'reserved'
	| 'consuming'
	| 'consumed'
	| 'released'
	| 'expired'
	| 'cancelled'
	| 'failed'
	| 'overran_pending_approval';
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

export interface ExecutionProfile {
	id: string;
	providerId?: string | null;
	laneId?: string | null;
	modelFamily?: string | null;
	modelClass?: string | null;
	contextWindowTokens?: number | null;
	qualityWeight: number;
	costMultiplier: number;
	latencyClass: 'low' | 'medium' | 'high' | string;
	concurrencyClass?: TaskConcurrencyClass | null;
	quotaBehavior?: 'api_metered' | 'subscription_limited' | 'compute_bound' | 'attention_bound' | string | null;
	metadata?: Record<string, unknown>;
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

export interface CapacityProvider {
	id: string;
	teamId: string | null;
	ownerTeamId: string | null;
	name: string;
	kind: CapacityProviderKind;
	status: CapacityProviderStatus;
	provider: TeamWebHostProvider | string;
	billingScope: CapacityProviderBillingScope;
	monthlyCreditBudget: number;
	dailyCreditBudget: number;
	creditBudgetMode?: 'static' | 'hybrid' | 'derived' | string;
	maxConcurrentWorkdays: number;
	maxConcurrentWorkers: number;
	capacityModel: Record<string, unknown>;
	connectionState?: string | null;
	lastSeenAt?: string | null;
	activeKeyPrefix?: string | null;
	lastRotatedAt?: string | null;
	rotationRequired?: boolean;
	capabilities?: unknown[];
	budgets?: Record<string, unknown>;
	deployment?: Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ExecutionProviderNativeLimit {
	id: string;
	executionProviderId: string;
	scope: string;
	nativeUnit: string;
	limitAmount: number;
	reserveBufferPercent: number;
	resetCadence: string | null;
	resetAt: string | null;
	confidence: string;
	source: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ExecutionProviderObservation {
	id: string;
	executionProviderId: string;
	observedAt: string;
	health: string;
	activeWorkers: number | null;
	queuedTasks: number | null;
	throttleState: string | null;
	nativeRemaining: Record<string, unknown>;
	resetAt: string | null;
	confidence: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface ExecutionProvider {
	id: string;
	teamId: string;
	capacityProviderId: string | null;
	name: string;
	kind: string;
	status: string;
	nativeUnit: string;
	quotaVisibility: string;
	maxConcurrentWorkers: number;
	resetCadence: string | null;
	config: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	nativeLimits?: ExecutionProviderNativeLimit[];
	latestObservation?: ExecutionProviderObservation | null;
	createdAt: string;
	updatedAt: string;
}

export interface CapacityProviderHost {
	id: string;
	capacityProviderId: string;
	hostId: string;
	role: string;
	required: boolean;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CapacityProviderLane {
	id: string;
	capacityProviderId: string;
	name: string;
	businessModel: CapacityBusinessModel;
	modelFamily: string | null;
	modelClass: string | null;
	regionPolicy: string | null;
	unit: CapacityLaneUnit | string;
	scarcityLevel: CapacityScarcityLevel;
	hardLimits: Record<string, unknown>;
	routingPolicy: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CapacityGrant {
	id: string;
	capacityProviderId: string;
	laneId: string | null;
	grantScope: CapacityGrantScope;
	teamId: string;
	projectId: string | null;
	environment: ProjectEnvironmentName | 'local' | null;
	state: CapacityGrantState;
	dailyCreditLimit: number | null;
	weeklyCreditLimit: number | null;
	monthlyCreditLimit: number | null;
	dailyUsdLimit: number | null;
	weeklyQuotaMinutes: number | null;
	monthlyProviderUnits: number | null;
	portfolioAllocationPercent?: number | null;
	reservePoolPercent?: number | null;
	maxDailyProjectCredits?: number | null;
	emergencyOverride?: boolean;
	priorityWeight: number;
	overflowPolicy: CapacityOverflowPolicy;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CapacityReservation {
	id: string;
	capacityProviderId: string;
	executionProviderId?: string | null;
	laneId: string;
	teamId: string;
	projectId: string;
	workDayId: string | null;
	taskId: string | null;
	state: CapacityReservationState;
	reservedCredits: number;
	consumedCredits: number;
	nativeUnit?: string | null;
	reservedNativeAmount?: number | null;
	consumedNativeAmount?: number | null;
	reservedProviderUnits: number | null;
	consumedProviderUnits: number | null;
	reservedUsd: number | null;
	consumedUsd: number | null;
	expiresAt: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface CapacityLedgerEntry {
	id: string;
	capacityProviderId: string;
	laneId: string | null;
	reservationId: string | null;
	teamId: string;
	projectId: string | null;
	workDayId: string | null;
	taskId: string | null;
	phase: TaskCreditLedgerEntry['phase'];
	credits: number;
	providerUnits: number | null;
	usd: number | null;
	source: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface CapacityRoutingDecision {
	id: string;
	taskId: string | null;
	workDayId: string | null;
	projectId: string;
	selectedProviderId: string;
	selectedLaneId: string;
	selectedModel: string | null;
	decision: string;
	reason: string;
	candidates: Record<string, unknown>[];
	scores: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface TaskEstimate {
	id: string;
	taskId: string | null;
	workDayId: string | null;
	projectId: string;
	estimatePhase: CapacityEstimatePhase;
	taskSignature: string;
	executionProfileId: string;
	confidence: CapacityEstimateConfidence;
	estimatedCreditsP50: number;
	estimatedCreditsP90: number;
	reservedCredits: number;
	estimatedInputTokensP50: number | null;
	estimatedInputTokensP90: number | null;
	estimatedOutputTokensP50: number | null;
	estimatedOutputTokensP90: number | null;
	estimatedQuotaMinutesP50: number | null;
	estimatedQuotaMinutesP90: number | null;
	features: Record<string, unknown>;
	createdAt: string;
}

export interface TaskUsageActual {
	id: string;
	taskId: string | null;
	workDayId: string | null;
	projectId: string;
	taskSignature: string;
	executionProfileId: string;
	capacityProviderId: string | null;
	executionProviderId?: string | null;
	laneId: string | null;
	businessModel: CapacityBusinessModel | string;
	modelName: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	cachedInputTokens: number | null;
	quotaMinutes: number | null;
	wallMinutes: number | null;
	filesOpened: number | null;
	filesChanged: number | null;
	diffLinesAdded: number | null;
	diffLinesRemoved: number | null;
	testRuns: number | null;
	retryCount: number | null;
	actualCredits: number;
	actualUsd: number | null;
	creditFormulaVersion?: string | null;
	actualCreditSource?: string | null;
	nativeUsage?: NativeUsageObservation | Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface NativeUsageObservation {
	nativeUnit?: string | null;
	amount?: number | null;
	wallMinutes?: number | null;
	quotaMinutes?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	cachedInputTokens?: number | null;
	usd?: number | null;
	filesOpened?: number | null;
	filesChanged?: number | null;
	diffLinesAdded?: number | null;
	diffLinesRemoved?: number | null;
	testRuns?: number | null;
	retryCount?: number | null;
	partial?: boolean | null;
	interrupted?: boolean | null;
	source?: string | null;
	observedAt?: string | null;
	metadata?: Record<string, unknown> | null;
	[key: string]: unknown;
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

export interface DerivedCapacityInput {
	executionProvider: ExecutionProvider;
	nativeLimit?: ExecutionProviderNativeLimit | null;
	latestObservation?: ExecutionProviderObservation | null;
	activeReservations?: CapacityReservation[];
	conversionProfile?: CreditConversionProfile | null;
	scope?: string | null;
	nativeUnit?: string | null;
	now?: Date | string | null;
}

export interface TaskEstimateProfile {
	taskSignature: string;
	executionProfileId: string;
	sampleCount: number;
	completedSampleCount?: number;
	interruptedSampleCount?: number;
	inputTokensP50: number | null;
	inputTokensP90: number | null;
	outputTokensP50: number | null;
	outputTokensP90: number | null;
	quotaMinutesP50: number | null;
	quotaMinutesP90: number | null;
	filesChangedP50: number | null;
	filesChangedP90: number | null;
	creditsP50: number | null;
	creditsP90: number | null;
	creditsVariance?: number | null;
	confidenceScore?: number | null;
	outlierCount?: number;
	partialCredits?: number | null;
	firstSampleAt?: string | null;
	lastSampleAt?: string | null;
	updatedAt: string;
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

export interface CapacityTaskExecutionEnvelope {
	providerId?: string | null;
	laneId?: string | null;
	model?: string | null;
	modelClass?: string | null;
	reservationIds?: string[];
	maxCredits?: number | null;
	maxProviderUnits?: number | null;
	maxUsd?: number | null;
	allowedFallbacks?: Array<Record<string, unknown>>;
	approvalBehavior?: 'auto' | 'pause_task' | 'fail_task';
	pausePolicy?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface CapacityPlan {
	projectId: string;
	teamId: string;
	environment: ProjectEnvironmentName | 'local';
	providers: CapacityProvider[];
	lanes: CapacityProviderLane[];
	grants: CapacityGrant[];
	activeReservations: CapacityReservation[];
	estimateProfiles: TaskEstimateProfile[];
	derivedCapacity?: DerivedCapacitySummary | null;
	remaining: {
		dailyCredits: number | null;
		weeklyCredits: number | null;
		monthlyCredits: number | null;
		weeklyQuotaMinutes: number | null;
		dailyUsd: number | null;
	};
}

export interface ProjectWorkdaySummary {
	id: string;
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	workDayId: string;
	kind: string;
	state: string | null;
	startedAt: string | null;
	endedAt: string | null;
	summary: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ScaleDecision {
	id: string;
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	poolName: string;
	workDayId: string | null;
	desiredWorkers: number;
	observedQueueDepth: number;
	observedActiveLeases: number;
	reason: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface RunnerScaleDecision {
	id: string;
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	workDayId: string | null;
	runnerId: string | null;
	runnerServiceName: string | null;
	action: 'wake' | 'sleep' | 'drain' | 'provision' | 'noop';
	reason: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

export interface WorkerPoolScaleResult {
	applied: boolean;
	provider: string;
	desiredWorkers: number;
	metadata?: Record<string, unknown>;
}

export interface WorkerPoolScaler {
	scale(decision: ScaleDecision): Promise<WorkerPoolScaleResult>;
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
	| 'content_lease'
	| 'work_day'
	| 'task'
	| 'task_event'
	| 'task_output'
	| 'graph_run'
	| 'report';

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

export interface SdkWorkDayEntity {
	[key: string]: unknown;
	id: string;
	projectId: string;
	state: string;
	capacityBudget: number;
	capacityUsed: number;
	graphVersion: string | null;
	summaryJson: string | null;
	startedAt: string;
	endedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface SdkTaskEntity {
	[key: string]: unknown;
	id: string;
	workDayId: string;
	agentId: string;
	type: string;
	state: string;
	priority: number;
	idempotencyKey: string;
	payloadJson: string;
	payloadHash: string | null;
	attemptCount: number;
	maxAttempts: number;
	claimedBy: string | null;
	leaseExpiresAt: string | null;
	availableAt: string;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	graphVersion: string | null;
	parentTaskId: string | null;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	updatedAt: string;
}

export interface SdkTaskEventEntity {
	[key: string]: unknown;
	id: string;
	taskId: string;
	seq: number;
	kind: string;
	dataJson: string;
	createdAt: string;
}

export interface SdkTaskOutputEntity {
	[key: string]: unknown;
	id: string;
	taskId: string;
	outputJson: string;
	outputRef: string | null;
	createdAt: string;
}

export interface SdkGraphRunEntity {
	[key: string]: unknown;
	id: string;
	workDayId: string;
	corpusHash: string;
	graphVersion: string;
	queryJson?: string | null;
	seedIdsJson?: string | null;
	selectedNodeIdsJson?: string | null;
	statsJson: string | null;
	snapshotRef: string | null;
	createdAt: string;
}

export interface SdkReportEntity {
	[key: string]: unknown;
	id: string;
	workDayId: string;
	kind: string;
	bodyJson: string;
	renderedRef: string | null;
	sentAt: string | null;
	createdAt: string;
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

export interface SdkStartWorkDayRequest {
	id?: string;
	projectId: string;
	capacityBudget?: number;
	graphVersion?: string | null;
	summary?: Record<string, unknown> | null;
	actor: string;
}

export interface SdkUpsertWorkPolicyRequest {
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	schedule: WorkdaySchedule;
	enabled?: boolean;
	startCron?: string;
	durationMinutes?: number;
	maxRunners?: number;
	maxWorkersPerRunner?: number;
	dailyCreditBudget?: number;
	closeoutGraceMinutes?: number;
	dailyTaskCreditBudget: number;
	maxQueuedTasks: number;
	maxQueuedCredits: number;
	autoscale: AgentPoolAutoscalePolicy;
	creditWeights?: TaskCreditWeight[];
	metadata?: Record<string, unknown> | null;
}

export interface SdkCreateWorkdayRequest {
	id?: string;
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	type: WorkdayRequestType;
	state?: WorkdayRequestState;
	workDayId?: string | null;
	requestedBy?: string | null;
	reason?: string | null;
	payload?: Record<string, unknown> | null;
	metadata?: Record<string, unknown> | null;
}

export interface SdkClaimWorkdayManagerLeaseRequest {
	id?: string;
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	workDayId?: string | null;
	managerId: string;
	ttlSeconds: number;
	staleAfterSeconds?: number;
	now?: string;
	metadata?: Record<string, unknown> | null;
}

export interface SdkReleaseWorkdayManagerLeaseRequest {
	id: string;
	managerId: string;
}

export interface SdkRecordWorkerRunnerRequest {
	id?: string;
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	runnerId: string;
	runnerServiceName: string;
	volumeIdentity: string;
	state?: WorkerRunnerState;
	maxLocalWorkers: number;
	activeLocalWorkers?: number;
	claimedRepositoryIds?: string[];
	metadata?: Record<string, unknown> | null;
}

export interface SdkRecordRepositoryClaimRequest {
	id?: string;
	projectId: string;
	repositoryId: string;
	runnerId: string;
	runnerServiceName: string;
	volumeIdentity: string;
	lastSeenCommit?: string | null;
	lastTaskAt?: string | null;
	claimState?: RepositoryClaim['claimState'];
	metadata?: Record<string, unknown> | null;
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

export interface UpsertAgentPoolRequest {
	id?: string;
	teamId: string;
	environment: ProjectEnvironmentName;
	name: string;
	registrationIdentity?: string | null;
	serviceBaseUrl?: string | null;
	status?: AgentPoolStatus;
	autoscale?: Partial<AgentPoolAutoscalePolicy> | null;
	metadata?: Record<string, unknown> | null;
}

export interface RecordAgentPoolRegistrationRequest {
	poolId: string;
	id?: string;
	runnerId?: string | null;
	managerId?: string | null;
	serviceName?: string | null;
	heartbeatAt?: string | null;
	desiredWorkers?: number | null;
	observedQueueDepth?: number | null;
	observedActiveLeases?: number | null;
	metadata?: Record<string, unknown> | null;
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

export interface SdkPriorityOverrideRequest {
	id?: string;
	projectId: string;
	model: string;
	subjectId: string;
	priority: number;
	estimatedCredits?: number | null;
	metadata?: Record<string, unknown> | null;
}

export interface SdkCreatePrioritySnapshotRequest {
	id?: string;
	projectId: string;
	workDayId?: string | null;
	items: PrioritySnapshotItem[];
	metadata?: Record<string, unknown> | null;
}

export interface SdkRecordTaskCreditsRequest {
	id?: string;
	projectId: string;
	workDayId: string;
	taskId?: string | null;
	phase: TaskCreditLedgerEntry['phase'];
	credits: number;
	metadata?: Record<string, unknown> | null;
}

export interface UpsertCapacityProviderRequest {
	id?: string;
	teamId?: string | null;
	ownerTeamId?: string | null;
	name: string;
	kind?: CapacityProviderKind;
	status?: CapacityProviderStatus;
	provider: TeamWebHostProvider | string;
	billingScope?: CapacityProviderBillingScope;
	monthlyCreditBudget?: number;
	dailyCreditBudget?: number;
	maxConcurrentWorkdays?: number;
	maxConcurrentWorkers?: number;
	capacityModel?: Record<string, unknown> | null;
	metadata?: Record<string, unknown> | null;
}

export interface CreateCapacityProviderRequest {
	name: string;
	launchMode: 'self_hosted' | 'managed_market_host' | 'connected_host';
}

export interface CreateCapacityProviderResponse {
	ok: true;
	provider: CapacityProvider;
	apiKey: {
		plaintext: string;
		prefix: string;
	};
	selfHosting: Record<string, unknown>;
}

export interface RenameCapacityProviderRequest {
	name: string;
}

export interface CapacityProviderRotateKeyResponse {
	ok: true;
	apiKey: {
		plaintext: string;
		prefix: string;
	};
	requiresRestart: boolean;
}

export interface UpsertCapacityProviderHostRequest {
	id?: string;
	hostId: string;
	role: string;
	required?: boolean;
	metadata?: Record<string, unknown> | null;
}

export interface UpsertCapacityProviderLaneRequest {
	id?: string;
	name: string;
	businessModel?: CapacityBusinessModel;
	modelFamily?: string | null;
	modelClass?: string | null;
	regionPolicy?: string | null;
	unit?: CapacityLaneUnit | string;
	scarcityLevel?: CapacityScarcityLevel;
	hardLimits?: Record<string, unknown> | null;
	routingPolicy?: Record<string, unknown> | null;
	metadata?: Record<string, unknown> | null;
}

export interface UpsertCapacityGrantRequest {
	id?: string;
	capacityProviderId: string;
	laneId?: string | null;
	grantScope?: CapacityGrantScope;
	teamId: string;
	projectId?: string | null;
	environment?: ProjectEnvironmentName | 'local' | null;
	state?: CapacityGrantState;
	dailyCreditLimit?: number | null;
	weeklyCreditLimit?: number | null;
	monthlyCreditLimit?: number | null;
	dailyUsdLimit?: number | null;
	weeklyQuotaMinutes?: number | null;
	monthlyProviderUnits?: number | null;
	portfolioAllocationPercent?: number | null;
	reservePoolPercent?: number | null;
	maxDailyProjectCredits?: number | null;
	emergencyOverride?: boolean;
	priorityWeight?: number;
	overflowPolicy?: CapacityOverflowPolicy;
	metadata?: Record<string, unknown> | null;
}

export interface CreateCapacityReservationRequest {
	id?: string;
	capacityProviderId: string;
	executionProviderId?: string | null;
	laneId: string;
	teamId: string;
	projectId: string;
	workDayId?: string | null;
	taskId?: string | null;
	state?: CapacityReservationState;
	reservedCredits: number;
	nativeUnit?: string | null;
	reservedNativeAmount?: number | null;
	consumedNativeAmount?: number | null;
	reservedProviderUnits?: number | null;
	reservedUsd?: number | null;
	expiresAt?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface RecordCapacityUsageRequest {
	id?: string;
	capacityProviderId: string;
	laneId?: string | null;
	reservationId?: string | null;
	teamId: string;
	projectId?: string | null;
	workDayId?: string | null;
	taskId?: string | null;
	phase?: TaskCreditLedgerEntry['phase'];
	credits: number;
	nativeUnit?: string | null;
	nativeAmount?: number | null;
	providerUnits?: number | null;
	usd?: number | null;
	source?: string;
	metadata?: Record<string, unknown> | null;
	usageActual?: Record<string, unknown> | null;
}

export interface CreateCapacityRoutingDecisionRequest {
	id?: string;
	taskId?: string | null;
	workDayId?: string | null;
	projectId: string;
	selectedProviderId: string;
	selectedLaneId: string;
	selectedModel?: string | null;
	decision?: string;
	reason: string;
	candidates?: Record<string, unknown>[];
	scores?: Record<string, unknown>;
	metadata?: Record<string, unknown> | null;
}

export interface CreateTaskEstimateRequest {
	id?: string;
	taskId?: string | null;
	workDayId?: string | null;
	projectId: string;
	estimatePhase: CapacityEstimatePhase;
	taskSignature: string;
	executionProfileId?: string | null;
	confidence: CapacityEstimateConfidence;
	estimatedCreditsP50: number;
	estimatedCreditsP90: number;
	reservedCredits?: number;
	estimatedInputTokensP50?: number | null;
	estimatedInputTokensP90?: number | null;
	estimatedOutputTokensP50?: number | null;
	estimatedOutputTokensP90?: number | null;
	estimatedQuotaMinutesP50?: number | null;
	estimatedQuotaMinutesP90?: number | null;
	features?: Record<string, unknown> | null;
}

export interface CreateTaskUsageActualRequest {
	id?: string;
	taskId?: string | null;
	workDayId?: string | null;
	projectId: string;
	taskSignature: string;
	executionProfileId?: string | null;
	capacityProviderId?: string | null;
	executionProviderId?: string | null;
	laneId?: string | null;
	businessModel?: CapacityBusinessModel | string;
	modelName?: string | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	cachedInputTokens?: number | null;
	quotaMinutes?: number | null;
	wallMinutes?: number | null;
	filesOpened?: number | null;
	filesChanged?: number | null;
	diffLinesAdded?: number | null;
	diffLinesRemoved?: number | null;
	testRuns?: number | null;
	retryCount?: number | null;
	actualCredits?: number | null;
	actualUsd?: number | null;
	creditFormulaVersion?: string | null;
	actualCreditSource?: string | null;
	actualCreditsOverride?: boolean | null;
	nativeUsage?: NativeUsageObservation | Record<string, unknown> | null;
	metadata?: Record<string, unknown> | null;
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

export interface SdkRecordScaleDecisionRequest {
	id?: string;
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	poolName: string;
	workDayId?: string | null;
	desiredWorkers: number;
	observedQueueDepth: number;
	observedActiveLeases: number;
	reason: string;
	metadata?: Record<string, unknown> | null;
}

export interface SdkRecordRunnerScaleDecisionRequest {
	id?: string;
	projectId: string;
	environment: ProjectEnvironmentName | 'local';
	workDayId?: string | null;
	runnerId?: string | null;
	runnerServiceName?: string | null;
	action: RunnerScaleDecision['action'];
	reason: string;
	metadata?: Record<string, unknown> | null;
}

export interface SdkUpdateWorkDayGraphRequest {
	id: string;
	graphVersion: string;
	summaryPatch?: Record<string, unknown> | null;
}

export interface SdkCloseWorkDayRequest {
	id: string;
	state?: 'completed' | 'cancelled' | 'failed';
	summary?: Record<string, unknown> | null;
	actor: string;
}

export interface SdkCreateTaskRequest {
	id?: string;
	workDayId: string;
	agentId: string;
	type: string;
	state?: string;
	priority?: number;
	idempotencyKey: string;
	payload: Record<string, unknown>;
	payloadHash?: string | null;
	maxAttempts?: number;
	availableAt?: string;
	graphVersion?: string | null;
	parentTaskId?: string | null;
	actor: string;
}

export interface SdkClaimTaskRequest {
	id: string;
	workerId: string;
	leaseSeconds: number;
	actor: string;
}

export interface SdkTaskProgressRequest {
	id: string;
	workerId?: string | null;
	state?: string;
	appendEvent?: {
		kind: string;
		data?: Record<string, unknown>;
	} | null;
	patch?: Record<string, unknown>;
	actor: string;
}

export interface SdkCompleteTaskRequest {
	id: string;
	output?: Record<string, unknown> | null;
	outputRef?: string | null;
	summary?: Record<string, unknown> | null;
	actor: string;
}

export interface SdkFailTaskRequest {
	id: string;
	errorCode?: string | null;
	errorMessage: string;
	retryable?: boolean;
	nextVisibleAt?: string | null;
	actor: string;
}

export interface SdkAppendTaskEventRequest {
	taskId: string;
	kind: string;
	data?: Record<string, unknown>;
	actor: string;
}

export interface SdkEnqueueTaskRequest {
	taskId: string;
	queueName?: string;
	deliveryDelaySeconds?: number;
	actor: string;
}

export interface SdkCreateReportRequest {
	id?: string;
	workDayId: string;
	kind: string;
	body: Record<string, unknown>;
	renderedRef?: string | null;
	sentAt?: string | null;
	actor: string;
}

export interface SdkTaskSearchRequest {
	workDayId?: string;
	agentId?: string;
	state?: string | string[];
	limit?: number;
}

export interface SdkManagerContextRequest {
	taskId: string;
	includeGraph?: boolean;
}

export interface SdkManagerContextPayload {
	task: SdkTaskEntity | null;
	workDay: SdkWorkDayEntity | null;
	agent: Record<string, unknown> | null;
	graph: Record<string, unknown> | null;
}

export interface SdkQueuePullClientConfig {
	accountId: string;
	queueId: string;
	token: string;
	apiBaseUrl?: string;
	fetchImpl?: typeof fetch;
}

export interface SdkQueuePushClientConfig {
	accountId: string;
	queueId: string;
	token: string;
	apiBaseUrl?: string;
	fetchImpl?: typeof fetch;
}

export interface SdkQueuePullRequest {
	batchSize?: number;
	visibilityTimeoutMs?: number;
}

export interface SdkQueueMessageEnvelope {
	messageId: string;
	taskId: string;
	workDayId: string;
	agentId: string;
	taskType: string;
	idempotencyKey: string;
	attempt: number;
	payloadRef: string;
	graphVersion: string | null;
	budgetHint: number;
}

export interface SdkPulledQueueMessage {
	leaseId: string;
	attempts: number;
	body: SdkQueueMessageEnvelope;
	rawBody: string;
}

export interface SdkQueuePullResult {
	messages: SdkPulledQueueMessage[];
}

export interface SdkQueuePushRequest {
	message: SdkQueueMessageEnvelope;
	delaySeconds?: number;
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
		priceModel?: 'free' | 'paid' | 'contact' | 'one_time_current_version' | 'subscription_updates' | 'private';
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
