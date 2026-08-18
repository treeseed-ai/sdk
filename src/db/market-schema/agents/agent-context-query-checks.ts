import { sql } from 'drizzle-orm';
import { check,foreignKey,index,integer,pgTable,text,uniqueIndex } from 'drizzle-orm/pg-core';
import { projects } from '../governance/policy/governance-electorate-snapshots.ts';
import { teams } from '../support/subscribers.ts';

export const agentContextQueryChecks = pgTable('agent_context_query_checks', {
	id:text('id').primaryKey(),
	idempotencyKey:text('idempotency_key').notNull(),
	teamId:text('team_id').notNull(),
	projectId:text('project_id').notNull(),
	testId:text('test_id').notNull(),
	testRef:text('test_ref').notNull(),
	definitionKind:text('definition_kind').notNull(),
	definitionId:text('definition_id').notNull(),
	definitionRevision:integer('definition_revision').notNull(),
	definitionCommit:text('definition_commit').notNull(),
	status:text('status').notNull(),
	checkedAt:text('checked_at').notNull(),
	expiresAt:text('expires_at').notNull(),
	latencyMs:integer('latency_ms').notNull(),
	statsJson:text('stats_json').notNull(),
	assertionsJson:text('assertions_json').notNull(),
	resultDigest:text('result_digest').notNull(),
}, (table) => [
	foreignKey({name:'fk_agent_context_query_checks_team',columns:[table.teamId],foreignColumns:[teams.id]}).onDelete('cascade'),
	foreignKey({name:'fk_agent_context_query_checks_project',columns:[table.projectId],foreignColumns:[projects.id]}).onDelete('cascade'),
	uniqueIndex('idx_agent_context_query_checks_idempotency').on(table.teamId,table.idempotencyKey),
	index('idx_agent_context_query_checks_latest').on(table.projectId,table.definitionKind,table.definitionId,table.definitionRevision,table.checkedAt),
	check('chk_agent_context_query_checks_kind',sql`${table.definitionKind} IN ('query','query-set')`),
	check('chk_agent_context_query_checks_status',sql`${table.status} IN ('passing','failing','stale')`),
]);
