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
] as const;

export const SDK_OPERATIONS = ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'] as const;
export const SDK_STORAGE_BACKENDS = ['content', 'd1'] as const;
export const SDK_PICK_STRATEGIES = ['latest', 'highest_priority', 'oldest'] as const;
export const SDK_DISPATCH_EXECUTION_CLASSES = ['local_only', 'remote_inline', 'remote_job'] as const;
export const SDK_DISPATCH_TARGETS = ['local', 'project_api', 'project_runner', 'market_catalog'] as const;
export const SDK_DISPATCH_POLICIES = ['auto', 'prefer_local', 'prefer_remote', 'remote_only'] as const;
export const SDK_DISPATCH_NAMESPACES = ['sdk', 'workflow'] as const;
export const TREESEED_HOSTING_KINDS = ['market_control_plane', 'hosted_project', 'self_hosted_project'] as const;
export const TREESEED_HOSTING_REGISTRATIONS = ['optional', 'none'] as const;
export const PROJECT_CONNECTION_MODES = ['hosted', 'self_hosted', 'hybrid'] as const;
export const PROJECT_RUNNER_REGISTRATION_STATES = ['pending', 'registered', 'offline'] as const;
export const PROJECT_EXECUTION_OWNERS = ['project_api', 'project_runner', 'market'] as const;
export const REMOTE_JOB_STATUSES = ['pending', 'claimed', 'running', 'completed', 'failed', 'cancelled'] as const;
export const PROJECT_ENVIRONMENT_NAMES = ['local', 'staging', 'prod'] as const;
export const PROJECT_DEPLOYMENT_KINDS = ['provision', 'code', 'content', 'mixed'] as const;
export const PROJECT_DEPLOYMENT_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const PROJECT_INFRA_RESOURCE_PROVIDERS = ['cloudflare', 'railway', 'github', 'market'] as const;
export const PROJECT_INFRA_RESOURCE_KINDS = [
	'pages',
	'worker',
	'r2',
	'd1',
	'queue',
	'dlq',
	'railway_project',
	'railway_service',
	'railway_schedule',
] as const;
export const AGENT_POOL_STATUSES = ['pending', 'active', 'degraded', 'offline'] as const;

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
export type ProjectDeploymentStatus = (typeof PROJECT_DEPLOYMENT_STATUSES)[number];
export type ProjectInfrastructureResourceProvider = (typeof PROJECT_INFRA_RESOURCE_PROVIDERS)[number];
export type ProjectInfrastructureResourceKind = (typeof PROJECT_INFRA_RESOURCE_KINDS)[number];
export type AgentPoolStatus = (typeof AGENT_POOL_STATUSES)[number];
export type RemoteJobRequestedByType = 'user' | 'team_api_key' | 'service' | 'runner' | 'system';

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
	projectId: string;
	environment: ProjectEnvironmentName;
	deploymentKind: ProjectDeploymentKind;
	status: ProjectDeploymentStatus;
	sourceRef: string | null;
	releaseTag: string | null;
	commitSha: string | null;
	triggeredByType: string | null;
	triggeredById: string | null;
	metadata?: Record<string, unknown>;
	startedAt: string | null;
	finishedAt: string | null;
	createdAt: string;
	updatedAt: string;
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
	dailyTaskCreditBudget: number;
	maxQueuedTasks: number;
	maxQueuedCredits: number;
	autoscale: AgentPoolAutoscalePolicy;
	creditWeights: TaskCreditWeight[];
	metadata?: Record<string, unknown>;
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
	phase: 'seed' | 'settle' | 'refund';
	credits: number;
	metadata?: Record<string, unknown>;
	createdAt: string;
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
	dailyTaskCreditBudget: number;
	maxQueuedTasks: number;
	maxQueuedCredits: number;
	autoscale: AgentPoolAutoscalePolicy;
	creditWeights?: TaskCreditWeight[];
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
	sourceRef?: string | null;
	releaseTag?: string | null;
	commitSha?: string | null;
	triggeredByType?: string | null;
	triggeredById?: string | null;
	metadata?: Record<string, unknown> | null;
	startedAt?: string | null;
	finishedAt?: string | null;
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
	phase: 'seed' | 'settle' | 'refund';
	credits: number;
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
}

export interface SdkTemplateCatalogResponse {
	items: SdkTemplateCatalogEntry[];
	meta?: Record<string, unknown>;
}
