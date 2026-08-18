import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const agentLabViewState = pgTable('agent_lab_view_state', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	teamId: text('team_id').notNull(),
	namespace: text('namespace').notNull(),
	entityKind: text('entity_kind').notNull(),
	entityId: text('entity_id').notNull(),
	pinned: integer('pinned').notNull().default(0),
	hidden: integer('hidden').notNull().default(0),
	resolved: integer('resolved').notNull().default(0),
	layoutJson: text('layout_json').notNull().default('{}'),
	version: integer('version').notNull().default(1),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_agent_lab_view_state_owner_entity').on(table.userId, table.teamId, table.namespace, table.entityKind, table.entityId),
	index('idx_agent_lab_view_state_owner_namespace').on(table.userId, table.teamId, table.namespace, table.updatedAt),
]);
