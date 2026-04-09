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
}

export type SdkModelRegistry = Record<string, SdkModelDefinition>;

export interface SdkCreateMessageRequest {
	type: string;
	payload: Record<string, unknown>;
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
