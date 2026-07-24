import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

export const Schema = {
	subscribers,
	contactSubmissions,
};

export type DrizzleSchema = typeof Schema;
