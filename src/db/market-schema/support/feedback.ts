import { index,integer,pgTable,text,uniqueIndex } from 'drizzle-orm/pg-core';

const timestamps = {
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
};

export const feedbackSubmissions = pgTable('feedback_submissions', {
	id: text('id').primaryKey(),
	type: text('type').notNull(),
	status: text('status').notNull().default('new'),
	message: text('message').notNull(),
	submitterUserId: text('submitter_user_id').notNull(),
	teamId: text('team_id'),
	projectId: text('project_id'),
	canonicalPath: text('canonical_path').notNull(),
	routePattern: text('route_pattern'),
	capabilityId: text('capability_id'),
	environment: text('environment'),
	buildId: text('build_id'),
	revision: text('revision'),
	contextJson: text('context_json').notNull(),
	clientJson: text('client_json').notNull(),
	allowContact: integer('allow_contact').notNull().default(0),
	contactEmail: text('contact_email'),
	idempotencyKey: text('idempotency_key').notNull(),
	version: integer('version').notNull().default(1),
	resolvedAt: text('resolved_at'),
	...timestamps,
}, (table) => [
	index('idx_feedback_status_created').on(table.status, table.createdAt),
	index('idx_feedback_submitter_created').on(table.submitterUserId, table.createdAt),
	index('idx_feedback_team_created').on(table.teamId, table.createdAt),
	uniqueIndex('idx_feedback_submitter_idempotency').on(table.submitterUserId, table.idempotencyKey),
]);

export const feedbackAttachments = pgTable('feedback_attachments', {
	id: text('id').primaryKey(),
	feedbackId: text('feedback_id').notNull(),
	storageKey: text('storage_key').notNull().unique(),
	mimeType: text('mime_type').notNull(),
	byteSize: integer('byte_size').notNull(),
	width: integer('width'),
	height: integer('height'),
	digest: text('digest').notNull(),
	redactionVersion: text('redaction_version'),
	maskedRegionCount: integer('masked_region_count'),
	expiresAt: text('expires_at'),
	expiredAt: text('expired_at'),
	createdAt: text('created_at').notNull(),
}, (table) => [index('idx_feedback_attachments_feedback').on(table.feedbackId, table.createdAt)]);

export const feedbackStatusEvents = pgTable('feedback_status_events', {
	id: text('id').primaryKey(),
	feedbackId: text('feedback_id').notNull(),
	fromStatus: text('from_status'),
	toStatus: text('to_status').notNull(),
	note: text('note'),
	actorUserId: text('actor_user_id').notNull(),
	createdAt: text('created_at').notNull(),
}, (table) => [index('idx_feedback_status_events_feedback').on(table.feedbackId, table.createdAt)]);

export const feedbackExports = pgTable('feedback_exports', {
	id: text('id').primaryKey(),
	requestedByUserId: text('requested_by_user_id').notNull(),
	status: text('status').notNull().default('queued'),
	filtersJson: text('filters_json').notNull(),
	includeScreenshots: integer('include_screenshots').notNull().default(0),
	itemCount: integer('item_count').notNull().default(0),
	storageKey: text('storage_key'),
	digest: text('digest'),
	byteSize: integer('byte_size'),
	sourceClosure: text('source_closure'),
	error: text('error'),
	expiresAt: text('expires_at').notNull(),
	completedAt: text('completed_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_feedback_exports_status_expiry').on(table.status, table.expiresAt)]);

export const feedbackExportItems = pgTable('feedback_export_items', {
	exportId: text('export_id').notNull(),
	feedbackId: text('feedback_id').notNull(),
	createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('idx_feedback_export_items_pair').on(table.exportId, table.feedbackId)]);
