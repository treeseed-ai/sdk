import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Source of truth for the SDK/Core D1 schema used by unauthenticated static
// knowledge-hub runtime surfaces. Market control-plane tables belong in
// market-schema.ts and are PostgreSQL-only.

export const subscribers = sqliteTable('subscribers', {
	email: text('email').primaryKey(),
	createdAt: text('created_at').notNull(),
});

export const contactSubmissions = sqliteTable('contact_submissions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name'),
	email: text('email').notNull(),
	organization: text('organization'),
	contactType: text('contact_type'),
	subject: text('subject'),
	message: text('message').notNull(),
	userAgent: text('user_agent'),
	createdAt: text('created_at').notNull(),
	ipHash: text('ip_hash'),
}, (table) => [
	index('idx_contact_submissions_created_at').on(table.createdAt),
	index('idx_contact_submissions_email').on(table.email),
]);

export const runtimeRecords = sqliteTable('runtime_records', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	recordType: text('record_type').notNull(),
	recordKey: text('record_key').notNull(),
	lookupKey: text('lookup_key'),
	secondaryKey: text('secondary_key'),
	status: text('status').notNull(),
	schemaVersion: integer('schema_version').notNull().default(1),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	expiresAt: text('expires_at'),
	payloadJson: text('payload_json').notNull(),
	metaJson: text('meta_json').notNull(),
}, (table) => [
	index('idx_runtime_records_type_lookup_updated').on(table.recordType, table.lookupKey, table.updatedAt),
	index('idx_runtime_records_type_status_updated').on(table.recordType, table.status, table.updatedAt),
	uniqueIndex('idx_runtime_records_type_record_key').on(table.recordType, table.recordKey),
]);

export const treeseedSchema = {
	subscribers,
	contactSubmissions,
	runtimeRecords,
};

export type TreeseedDrizzleSchema = typeof treeseedSchema;
