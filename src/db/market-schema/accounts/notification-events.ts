import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';


export const notificationEvents = pgTable('notification_events', {
	id: text('id').primaryKey(),
	eventType: text('event_type').notNull(),
	contentType: text('content_type').notNull(),
	projectId: text('project_id').notNull(),
	actorId: text('actor_id'),
	resourceId: text('resource_id').notNull(),
	title: text('title').notNull(),
	summary: text('summary'),
	targetUrl: text('target_url').notNull(),
	createdAt: text('created_at').notNull(),
}, (table) => [index('idx_notification_events_project').on(table.projectId, table.createdAt)]);

export const userNotifications = pgTable('user_notifications', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	eventId: text('event_id').notNull(),
	readAt: text('read_at'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	uniqueIndex('idx_user_notifications_event').on(table.userId, table.eventId),
	index('idx_user_notifications_user').on(table.userId, table.readAt, table.createdAt),
]);

export const notificationEmailDeliveries = pgTable('notification_email_deliveries', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	eventId: text('event_id'),
	digestKey: text('digest_key').notNull().unique(),
	cadence: text('cadence').notNull(),
	status: text('status').notNull().default('pending'),
	dueAt: text('due_at').notNull(),
	attempts: integer('attempts').notNull().default(0),
	sentAt: text('sent_at'),
	lastError: text('last_error'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_notification_email_deliveries_due').on(table.status, table.dueAt)]);

export const creditConversionProfiles = pgTable('credit_conversion_profiles', {
	id: text('id').primaryKey(),
	taskSignature: text('task_signature').notNull(),
	executionProfileId: text('execution_profile_id').notNull().default('standard-code-model'),
	executionProviderKind: text('execution_provider_kind').notNull(),
	nativeUnit: text('native_unit').notNull(),
	sampleCount: integer('sample_count').notNull().default(0),
	completedSampleCount: integer('completed_sample_count').notNull().default(0),
	interruptedSampleCount: integer('interrupted_sample_count').notNull().default(0),
	nativeUnitsPerCreditP50: real('native_units_per_credit_p50'),
	nativeUnitsPerCreditP90: real('native_units_per_credit_p90'),
	creditsPerNativeUnitP50: real('credits_per_native_unit_p50'),
	creditsPerNativeUnitP90: real('credits_per_native_unit_p90'),
	actualCreditsP50: real('actual_credits_p50'),
	actualCreditsP90: real('actual_credits_p90'),
	confidence: text('confidence').notNull().default('low'),
	formulaVersion: text('formula_version').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_credit_conversion_profiles_profile_key').on(table.taskSignature, table.executionProfileId, table.executionProviderKind, table.nativeUnit),
	index('idx_credit_conversion_profiles_kind_unit').on(table.executionProviderKind, table.nativeUnit, table.updatedAt),
	check('chk_credit_conversion_profiles_sample_counts', sql`${table.sampleCount} >= 0 AND ${table.completedSampleCount} >= 0 AND ${table.interruptedSampleCount} >= 0 AND ${table.completedSampleCount} + ${table.interruptedSampleCount} <= ${table.sampleCount}`),
	check('chk_credit_conversion_profiles_native_p50', sql`${table.nativeUnitsPerCreditP50} IS NULL OR ${table.nativeUnitsPerCreditP50} >= 0`),
	check('chk_credit_conversion_profiles_native_p90', sql`${table.nativeUnitsPerCreditP90} IS NULL OR ${table.nativeUnitsPerCreditP90} >= 0`),
	check('chk_credit_conversion_profiles_credit_p50', sql`${table.creditsPerNativeUnitP50} IS NULL OR ${table.creditsPerNativeUnitP50} >= 0`),
	check('chk_credit_conversion_profiles_credit_p90', sql`${table.creditsPerNativeUnitP90} IS NULL OR ${table.creditsPerNativeUnitP90} >= 0`),
	check('chk_credit_conversion_profiles_actual_p50', sql`${table.actualCreditsP50} IS NULL OR ${table.actualCreditsP50} >= 0`),
	check('chk_credit_conversion_profiles_actual_p90', sql`${table.actualCreditsP90} IS NULL OR ${table.actualCreditsP90} >= 0`),
	check('chk_credit_conversion_profiles_confidence', sql`${table.confidence} IN ('low', 'medium', 'high')`)
]);

export const seedRuns = pgTable('seed_runs', {
	id: text('id').primaryKey(),
	seedName: text('seed_name').notNull(),
	seedVersion: integer('seed_version').notNull(),
	environmentsJson: text('environments_json').notNull(),
	mode: text('mode').notNull(),
	state: text('state').notNull(),
	actorType: text('actor_type'),
	actorId: text('actor_id'),
	manifestHash: text('manifest_hash').notNull(),
	planJson: text('plan_json').notNull(),
	resultJson: text('result_json'),
	errorJson: text('error_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	completedAt: text('completed_at'),
}, (table) => [
	index('idx_seed_runs_seed_created').on(table.seedName, table.createdAt),
	index('idx_seed_runs_state_created').on(table.state, table.createdAt)
]);

export const runtimeRecords = pgTable('runtime_records', {
	id: serial('id').primaryKey(),
	recordType: text('record_type').notNull(),
	recordKey: text('record_key').notNull(),
	lookupKey: text('lookup_key'),
	secondaryKey: text('secondary_key'),
	status: text('status').notNull(),
	schemaVersion: integer('schema_version').notNull().default(1),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	payloadJson: text('payload_json').notNull(),
	metaJson: text('meta_json').notNull(),
}, (table) => [
	index('idx_runtime_records_type_lookup_updated').on(table.recordType, table.lookupKey, table.updatedAt),
	index('idx_runtime_records_type_status_updated').on(table.recordType, table.status, table.updatedAt)
]);

export const cursorState = pgTable('cursor_state', {
	agentSlug: text('agent_slug'),
	cursorKey: text('cursor_key'),
	status: text('status').notNull(),
	schemaVersion: integer('schema_version').notNull().default(1),
	updatedAt: text('updated_at').notNull(),
	payloadJson: text('payload_json').notNull(),
	metaJson: text('meta_json').notNull(),
}, (table) => [
	primaryKey({ columns: [table.agentSlug, table.cursorKey] }),
	index('idx_cursor_state_updated').on(table.updatedAt)
]);

export const leaseState = pgTable('lease_state', {
	model: text('model'),
	itemKey: text('item_key'),
	status: text('status').notNull(),
	schemaVersion: integer('schema_version').notNull().default(1),
	claimedBy: text('claimed_by'),
	claimedAt: text('claimed_at'),
	leaseExpiresAt: text('lease_expires_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	payloadJson: text('payload_json').notNull(),
	metaJson: text('meta_json').notNull(),
}, (table) => [
	primaryKey({ columns: [table.model, table.itemKey] }),
	index('idx_lease_state_status_expires').on(table.status, table.leaseExpiresAt),
	index('idx_lease_state_claimed_by').on(table.claimedBy, table.updatedAt)
]);

export const messageQueue = pgTable('message_queue', {
	id: serial('id').primaryKey(),
	messageType: text('message_type').notNull(),
	status: text('status').notNull(),
	schemaVersion: integer('schema_version').notNull().default(1),
	relatedModel: text('related_model'),
	relatedId: text('related_id'),
	priority: integer('priority').notNull().default(0),
	availableAt: text('available_at').notNull(),
	claimedBy: text('claimed_by'),
	claimedAt: text('claimed_at'),
	leaseExpiresAt: text('lease_expires_at'),
	attempts: integer('attempts').notNull().default(0),
	maxAttempts: integer('max_attempts').notNull().default(3),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	payloadJson: text('payload_json').notNull(),
	metaJson: text('meta_json').notNull(),
}, (table) => [
	index('idx_message_queue_claimable').on(table.status, table.availableAt, table.priority),
	index('idx_message_queue_related').on(table.relatedModel, table.relatedId, table.createdAt)
]);

export const platformOperations = pgTable('platform_operations', {
	id: text('id').primaryKey(),
	namespace: text('namespace').notNull(),
	operation: text('operation').notNull(),
	status: text('status').notNull(),
	target: text('target').notNull(),
	idempotencyKey: text('idempotency_key'),
	inputJson: text('input_json').notNull().default('{}'),
	outputJson: text('output_json'),
	errorJson: text('error_json'),
	requestedByType: text('requested_by_type').notNull(),
	requestedById: text('requested_by_id'),
	assignedRunnerId: text('assigned_runner_id'),
	leaseExpiresAt: text('lease_expires_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	startedAt: text('started_at'),
	finishedAt: text('finished_at'),
	cancelledAt: text('cancelled_at'),
}, (table) => [
	uniqueIndex('idx_platform_operations_idempotency').on(table.namespace, table.operation, table.idempotencyKey),
	index('idx_platform_operations_runnable').on(table.status, table.createdAt)
]);

export const platformOperationEvents = pgTable('platform_operation_events', {
	id: text('id').primaryKey(),
	operationId: text('operation_id').notNull(),
	seq: integer('seq').notNull(),
	kind: text('kind').notNull(),
	dataJson: text('data_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	uniqueIndex('idx_platform_operation_events_seq').on(table.operationId, table.seq)
]);

export const marketOperationRunners = pgTable('market_operation_runners', {
	id: text('id').primaryKey(),
	runnerKey: text('runner_key').notNull().unique(),
	name: text('name').notNull(),
	environment: text('environment').notNull(),
	status: text('status').notNull().default('online'),
	version: text('version'),
	capabilitiesJson: text('capabilities_json').notNull().default('[]'),
	activeJobCount: integer('active_job_count').notNull().default(0),
	maxConcurrentJobs: integer('max_concurrent_jobs').notNull().default(1),
	heartbeatAt: text('heartbeat_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const platformRepositoryClaims = pgTable('platform_repository_claims', {
	id: text('id').primaryKey(),
	repositoryKey: text('repository_key').notNull(),
	runnerId: text('runner_id').notNull(),
	workspacePath: text('workspace_path').notNull(),
	branch: text('branch'),
	commitSha: text('commit_sha'),
	claimState: text('claim_state').notNull().default('active'),
	leaseExpiresAt: text('lease_expires_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_platform_repository_claims_active').on(table.repositoryKey, table.runnerId),
	index('idx_platform_repository_claims_runner').on(table.runnerId, table.claimState)
]);

export const marketAuthCredentials = pgTable('market_auth_credentials', {
	userId: text('user_id').primaryKey(),
	email: text('email').notNull().unique(),
	username: text('username').unique(),
	passwordHash: text('password_hash').notNull(),
	status: text('status').notNull().default('active'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const marketAuthPasswordResets = pgTable('market_auth_password_resets', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	tokenHash: text('token_hash').notNull().unique(),
	expiresAt: text('expires_at').notNull(),
	usedAt: text('used_at'),
	createdAt: text('created_at').notNull(),
});
