import type { TreeseedFieldAliasBinding } from './field-aliases.ts';

export const SDK_MODEL_NAMES = [
	'page',
	'note',
	'question',
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

export type SdkBuiltinModelName = (typeof SDK_MODEL_NAMES)[number];
export type SdkModelName = SdkBuiltinModelName | (string & {});
export type SdkOperation = (typeof SDK_OPERATIONS)[number];
export type SdkStorageBackend = (typeof SDK_STORAGE_BACKENDS)[number];
export type SdkPickStrategy = (typeof SDK_PICK_STRATEGIES)[number];
export type SdkComparableAs = 'string' | 'number' | 'date' | 'boolean' | 'string_array';

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

export interface SdkGatewayClientConfig {
	baseUrl: string;
	bearerToken: string;
	fetchImpl?: typeof fetch;
}

export interface SdkQueuePullClientConfig {
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

export interface SdkTemplateCatalogSource {
	kind: 'git';
	repoUrl: string;
	directory: string;
	ref: string;
	integrity?: string;
}

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
		mode?: 'packaged' | 'git';
		source: SdkTemplateCatalogSource;
		hooksPolicy: 'builtin_only' | 'trusted_only' | 'disabled';
		supportsReconcile: boolean;
	};
	offer?: {
		priceModel?: 'free' | 'paid' | 'contact';
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
