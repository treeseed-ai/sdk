import { sql } from 'drizzle-orm';
import { check,foreignKey,index,integer,pgTable,text,uniqueIndex } from 'drizzle-orm/pg-core';
import { projects } from '../governance/policy/governance-electorate-snapshots.ts';
import { teams,users } from '../support/subscribers.ts';
import { capacityProviderAssignments } from '../capacity/accounting/capacity-ledger-entries.ts';

export const agentClientSessions = pgTable('agent_client_sessions', {
	id:text('id').primaryKey(), userId:text('user_id').notNull(), teamId:text('team_id').notNull(), projectId:text('project_id').notNull(),
	route:text('route').notNull(), capabilitiesJson:text('capabilities_json').notNull().default('[]'), status:text('status').notNull().default('active'),
	heartbeatAt:text('heartbeat_at').notNull(), expiresAt:text('expires_at').notNull(), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},(table)=>[
	foreignKey({name:'fk_agent_client_sessions_user',columns:[table.userId],foreignColumns:[users.id]}).onDelete('cascade'),
	foreignKey({name:'fk_agent_client_sessions_team',columns:[table.teamId],foreignColumns:[teams.id]}).onDelete('cascade'),
	foreignKey({name:'fk_agent_client_sessions_project',columns:[table.projectId],foreignColumns:[projects.id]}).onDelete('cascade'),
	index('idx_agent_client_sessions_scope').on(table.userId,table.teamId,table.projectId,table.status,table.expiresAt),
	check('chk_agent_client_sessions_status',sql`${table.status} IN ('active','closed','expired')`),
]);

export const agentClientActions = pgTable('agent_client_actions', {
	id:text('id').primaryKey(), sessionId:text('session_id'), assignmentId:text('assignment_id').notNull(), userId:text('user_id').notNull(),
	teamId:text('team_id').notNull(), projectId:text('project_id').notNull(), kind:text('kind').notNull(), payloadJson:text('payload_json').notNull().default('{}'),
	status:text('status').notNull().default('pending'), idempotencyKey:text('idempotency_key').notNull(), requestDigest:text('request_digest').notNull(),
	expiresAt:text('expires_at').notNull(), completedAt:text('completed_at'), resultJson:text('result_json').notNull().default('{}'), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},(table)=>[
	foreignKey({name:'fk_agent_client_actions_session',columns:[table.sessionId],foreignColumns:[agentClientSessions.id]}).onDelete('set null'),
	foreignKey({name:'fk_agent_client_actions_assignment',columns:[table.assignmentId],foreignColumns:[capacityProviderAssignments.id]}).onDelete('restrict'),
	foreignKey({name:'fk_agent_client_actions_user',columns:[table.userId],foreignColumns:[users.id]}).onDelete('cascade'),
	foreignKey({name:'fk_agent_client_actions_team',columns:[table.teamId],foreignColumns:[teams.id]}).onDelete('cascade'),
	foreignKey({name:'fk_agent_client_actions_project',columns:[table.projectId],foreignColumns:[projects.id]}).onDelete('cascade'),
	uniqueIndex('idx_agent_client_actions_idempotency').on(table.assignmentId,table.idempotencyKey),
	index('idx_agent_client_actions_session_status').on(table.sessionId,table.status,table.createdAt),
	check('chk_agent_client_actions_kind',sql`${table.kind} IN ('navigate','reveal-resource','set-view-filter','populate-draft','present-confirmation')`),
	check('chk_agent_client_actions_status',sql`${table.status} IN ('pending','completed','rejected','expired','failed','unavailable')`),
]);

export const agentOperationHandoffs = pgTable('agent_operation_handoffs', {
	id:text('id').primaryKey(), assignmentId:text('assignment_id').notNull(), invocationId:text('invocation_id'), discussionId:text('discussion_id').notNull(),
	teamId:text('team_id').notNull(), projectId:text('project_id').notNull(), status:text('status').notNull().default('awaiting-approval'),
	target:text('target').notNull(), expectedEffect:text('expected_effect').notNull(), inputsJson:text('inputs_json').notNull().default('{}'),
	sourceMessageRefsJson:text('source_message_refs_json').notNull().default('[]'), requiredAuthorityJson:text('required_authority_json').notNull().default('[]'),
	proposalId:text('proposal_id'), decisionId:text('decision_id'), approvalRequestId:text('approval_request_id'), resultingAssignmentId:text('resulting_assignment_id'),
	idempotencyKey:text('idempotency_key').notNull(), requestDigest:text('request_digest').notNull(), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},(table)=>[
	foreignKey({name:'fk_agent_operation_handoffs_assignment',columns:[table.assignmentId],foreignColumns:[capacityProviderAssignments.id]}).onDelete('restrict'),
	foreignKey({name:'fk_agent_operation_handoffs_team',columns:[table.teamId],foreignColumns:[teams.id]}).onDelete('cascade'),
	foreignKey({name:'fk_agent_operation_handoffs_project',columns:[table.projectId],foreignColumns:[projects.id]}).onDelete('cascade'),
	uniqueIndex('idx_agent_operation_handoffs_idempotency').on(table.assignmentId,table.idempotencyKey),
	index('idx_agent_operation_handoffs_discussion').on(table.projectId,table.discussionId,table.status,table.createdAt),
	check('chk_agent_operation_handoffs_status',sql`${table.status} IN ('awaiting-approval','approved','scheduled','running','completed','failed','cancelled')`),
]);
