import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { capacityWorkdayRuns } from './agent-mode-runs.ts';
import { teams } from './subscribers.ts';
import { projects } from './governance-electorate-snapshots.ts';
import { capacityAllocationSets, capacityProviderAssignments, projectAgentClasses } from './capacity-ledger-entries.ts';

export const capacityWorkdayEvents = pgTable('capacity_workday_events', {
	id: text('id').primaryKey(),
	runId: text('run_id').notNull(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	workdayId: text('workday_id'),
	assignmentId: text('assignment_id'),
	modeRunId: text('mode_run_id'),
	eventIndex: integer('event_index').notNull(),
	eventType: text('event_type').notNull(),
	status: text('status').notNull().default('recorded'),
	title: text('title'),
	message: text('message'),
	parametersJson: text('parameters_json').notNull().default('{}'),
	contextJson: text('context_json').notNull().default('{}'),
	refsJson: text('refs_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_workday_events_run', columns: [table.runId], foreignColumns: [capacityWorkdayRuns.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_events_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_workday_events_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('restrict'),
	uniqueIndex('idx_capacity_workday_events_run_index').on(table.runId, table.eventIndex),
	index('idx_capacity_workday_events_project').on(table.projectId, table.createdAt),
	check('chk_capacity_workday_events_index', sql`${table.eventIndex} >= 0`),
	check('chk_capacity_workday_events_status', sql`${table.status} IN ('recorded','active','completed','warning','error','failed')`)
]);

export const capacityWorkdayParticipationCycles = pgTable('capacity_workday_participation_cycles', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	workdayRunId: text('workday_run_id').notNull(),
	cycleNumber: integer('cycle_number').notNull(),
	status: text('status').notNull().default('open'),
	openedAt: text('opened_at').notNull(),
	coveredAt: text('covered_at'),
	closedAt: text('closed_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_workday_participation_cycles_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_workday_participation_cycles_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_participation_cycles_run', columns: [table.workdayRunId], foreignColumns: [capacityWorkdayRuns.id] }).onDelete('restrict'),
	uniqueIndex('idx_capacity_workday_participation_cycles_number').on(table.workdayRunId, table.projectId, table.cycleNumber),
	index('idx_capacity_workday_participation_cycles_status').on(table.workdayRunId, table.status, table.projectId),
	check('chk_capacity_workday_participation_cycles_number', sql`${table.cycleNumber} >= 1`),
	check('chk_capacity_workday_participation_cycles_status', sql`${table.status} IN ('open','covered','closed')`),
]);

export const workdayCapacityEnvelopes = pgTable('workday_capacity_envelopes', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	workdayRunId: text('workday_run_id').references(() => capacityWorkdayRuns.id, { onDelete: 'restrict' }),
	allocationSetId: text('allocation_set_id'),
	status: text('status').notNull().default('draft'),
	startedAt: text('started_at'),
	pausedAt: text('paused_at'),
	completedAt: text('completed_at'),
	envelopeJson: text('envelope_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_workday_capacity_envelopes_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_workday_capacity_envelopes_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_workday_capacity_envelopes_allocation', columns: [table.allocationSetId], foreignColumns: [capacityAllocationSets.id] }).onDelete('restrict'),
	index('idx_workday_capacity_envelopes_run_status').on(table.workdayRunId, table.status, table.id),
	index('idx_workday_capacity_envelopes_project_status').on(table.projectId, table.status, table.createdAt),
	index('idx_workday_capacity_envelopes_team_status').on(table.teamId, table.status, table.createdAt),
	check('chk_workday_capacity_envelopes_status', sql`${table.status} IN ('draft','queued','active','paused','completed','cancelled','failed','degraded')`)
]);

export const agentCapacityPlans = pgTable('agent_capacity_plans', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	decisionId: text('decision_id').notNull(),
	status: text('status').notNull().default('draft'),
	scopeHash: text('scope_hash').notNull(),
	allocationSetId: text('allocation_set_id'),
	workDayId: text('work_day_id'),
	expectedCredits: real('expected_credits').notNull().default(0),
	highCredits: real('high_credits').notNull().default(0),
	workUnitsJson: text('work_units_json').notNull().default('[]'),
	capabilityNeedsJson: text('capability_needs_json').notNull().default('[]'),
	environmentNeedsJson: text('environment_needs_json').notNull().default('[]'),
	reservesJson: text('reserves_json').notNull().default('{}'),
	blockersJson: text('blockers_json').notNull().default('[]'),
	priorityRationale: text('priority_rationale'),
	reviewJson: text('review_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	acceptedAt: text('accepted_at'),
	scheduledAt: text('scheduled_at'),
	supersededAt: text('superseded_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_agent_capacity_plans_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_agent_capacity_plans_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_agent_capacity_plans_allocation', columns: [table.allocationSetId], foreignColumns: [capacityAllocationSets.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_agent_capacity_plans_workday', columns: [table.workDayId], foreignColumns: [workdayCapacityEnvelopes.id] }).onDelete('restrict'),
	index('idx_agent_capacity_plans_decision').on(table.decisionId, table.status, table.createdAt),
	index('idx_agent_capacity_plans_project').on(table.projectId, table.status, table.createdAt),
	index('idx_agent_capacity_plans_workday').on(table.workDayId, table.status, table.createdAt),
	check('chk_agent_capacity_plans_status', sql`${table.status} IN ('draft','accepted','revision_requested','deferred','scheduled','active','completed','superseded')`),
	check('chk_agent_capacity_plans_credits', sql`${table.expectedCredits} >= 0 AND ${table.highCredits} >= ${table.expectedCredits}`)
]);

export const capacityWorkdayDemands = pgTable('capacity_workday_demands', {
	id: text('id').primaryKey(), teamId: text('team_id').notNull(), projectId: text('project_id').notNull(),
	workdayRunId: text('workday_run_id').notNull(), workdayId: text('workday_id').notNull(),
	sourceType: text('source_type').notNull(), sourceId: text('source_id').notNull(), mode: text('mode').notNull(),
	projectAgentClassId: text('project_agent_class_id').notNull(), agentId: text('agent_id'),
	handlerId: text('handler_id').notNull(), activityType: text('activity_type').notNull(),
	decisionId: text('decision_id'), capacityPlanId: text('capacity_plan_id'), status: text('status').notNull().default('pending'),
	priority: integer('priority').notNull().default(0), requestedCredits: real('requested_credits').notNull(),
	idempotencyKey: text('idempotency_key').notNull(), claimToken: text('claim_token'), assignmentId: text('assignment_id'),
	payloadJson: text('payload_json').notNull().default('{}'), metadataJson: text('metadata_json').notNull().default('{}'),
	availableAt: text('available_at').notNull(), claimedAt: text('claimed_at'), admittedAt: text('admitted_at'),
	completedAt: text('completed_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_workday_demands_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_workday_demands_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_demands_run', columns: [table.workdayRunId], foreignColumns: [capacityWorkdayRuns.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_demands_workday', columns: [table.workdayId], foreignColumns: [workdayCapacityEnvelopes.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_demands_agent_class', columns: [table.projectAgentClassId], foreignColumns: [projectAgentClasses.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_demands_assignment', columns: [table.assignmentId], foreignColumns: [capacityProviderAssignments.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_demands_capacity_plan', columns: [table.capacityPlanId], foreignColumns: [agentCapacityPlans.id] }).onDelete('restrict'),
	uniqueIndex('idx_capacity_workday_demands_idempotency').on(table.teamId, table.idempotencyKey),
	uniqueIndex('idx_capacity_workday_demands_assignment').on(table.assignmentId),
	uniqueIndex('idx_capacity_workday_demands_claim').on(table.claimToken),
	index('idx_capacity_workday_demands_ready').on(table.teamId, table.status, table.availableAt, table.priority),
	index('idx_capacity_workday_demands_run').on(table.workdayRunId, table.projectId, table.status, table.createdAt),
	check('chk_capacity_workday_demands_mode', sql`${table.mode} IN ('planning','acting')`),
	check('chk_capacity_workday_demands_status', sql`${table.status} IN ('pending','claimed','admitted','completed','blocked','cancelled','superseded')`),
	check('chk_capacity_workday_demands_source', sql`${table.sourceType} IN ('objective','question','proposal','decision-review','knowledge-gap','release-readiness','idle-intent','planning-input','capacity-plan','assignment-completion','assignment-blockage','workday-summary','handoff','research-workflow')`),
	check('chk_capacity_workday_demands_credits', sql`${table.requestedCredits} > 0`),
]);

export const capacityWorkdayParticipationEntries = pgTable('capacity_workday_participation_entries', {
	id: text('id').primaryKey(), cycleId: text('cycle_id').notNull(), teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(), workdayRunId: text('workday_run_id').notNull(), agentId: text('agent_id').notNull(),
	projectAgentClassId: text('project_agent_class_id').notNull(), status: text('status').notNull().default('pending'),
	reasonCode: text('reason_code'), demandId: text('demand_id'), assignmentId: text('assignment_id'), coveredAt: text('covered_at'),
	metadataJson: text('metadata_json').notNull().default('{}'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_workday_participation_entries_cycle', columns: [table.cycleId], foreignColumns: [capacityWorkdayParticipationCycles.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_participation_entries_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_workday_participation_entries_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_participation_entries_run', columns: [table.workdayRunId], foreignColumns: [capacityWorkdayRuns.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_participation_entries_agent_class', columns: [table.projectAgentClassId], foreignColumns: [projectAgentClasses.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_participation_entries_demand', columns: [table.demandId], foreignColumns: [capacityWorkdayDemands.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_workday_participation_entries_assignment', columns: [table.assignmentId], foreignColumns: [capacityProviderAssignments.id] }).onDelete('restrict'),
	uniqueIndex('idx_capacity_workday_participation_entries_agent').on(table.cycleId, table.agentId),
	uniqueIndex('idx_capacity_workday_participation_entries_demand').on(table.demandId),
	index('idx_capacity_workday_participation_entries_status').on(table.workdayRunId, table.projectId, table.status, table.agentId),
	check('chk_capacity_workday_participation_entries_status', sql`${table.status} IN ('pending','assigned','completed','excluded','blocked')`),
]);

export const treeDxProxyHandles = pgTable('treedx_proxy_handles', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	assignmentId: text('assignment_id'),
	repositoryId: text('repository_id'),
	workspaceId: text('workspace_id'),
	status: text('status').notNull().default('issued'),
	scopesJson: text('scopes_json').notNull().default('[]'),
	allowedOperationsJson: text('allowed_operations_json').notNull().default('[]'),
	allowedPathsJson: text('allowed_paths_json').notNull().default('[]'),
	allowedReadPathsJson: text('allowed_read_paths_json').notNull().default('[]'),
	allowedWritePathsJson: text('allowed_write_paths_json').notNull().default('[]'),
	tokenHash: text('token_hash'),
	expiresAt: text('expires_at'),
	issuedAt: text('issued_at').notNull(),
	revokedAt: text('revoked_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_treedx_proxy_handles_assignment').on(table.assignmentId, table.status, table.expiresAt),
	index('idx_treedx_proxy_handles_project').on(table.projectId, table.status, table.updatedAt)
]);

export const treeDxProjectProxyAudit = pgTable('treedx_project_proxy_audit', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	assignmentId: text('assignment_id'),
	actorType: text('actor_type').notNull(),
	actorId: text('actor_id'),
	method: text('method').notNull(),
	path: text('path').notNull(),
	handleJson: text('handle_json').notNull().default('{}'),
	resultStatus: text('result_status').notNull().default('observed'),
	reasonCode: text('reason_code'),
	reason: text('reason'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_treedx_project_proxy_audit_project').on(table.projectId, table.createdAt),
	index('idx_treedx_project_proxy_audit_assignment').on(table.assignmentId, table.createdAt),
	index('idx_treedx_project_proxy_audit_result').on(table.projectId, table.resultStatus, table.createdAt)
]);

export const secretMetadataRecords = pgTable('secret_metadata_records', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	name: text('name').notNull(),
	secretClass: text('secret_class').notNull(),
	custodyMode: text('custody_mode').notNull(),
	ownerKind: text('owner_kind').notNull(),
	status: text('status').notNull().default('active'),
	githubSecretTargetJson: text('github_secret_target_json').notNull().default('{}'),
	escrowRecordId: text('escrow_record_id'),
	apiDecryptable: integer('api_decryptable').notNull().default(0),
	plaintextAllowed: integer('plaintext_allowed').notNull().default(0),
	failClosedCode: text('fail_closed_code'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	tombstonedAt: text('tombstoned_at'),
}, (table) => [
	index('idx_secret_metadata_team_project').on(table.teamId, table.projectId, table.status),
	index('idx_secret_metadata_custody').on(table.custodyMode, table.status),
	uniqueIndex('idx_secret_metadata_team_name').on(table.teamId, table.projectId, table.name)
]);

export const clientEncryptedEscrowRecords = pgTable('client_encrypted_escrow_records', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	secretId: text('secret_id').notNull(),
	status: text('status').notNull().default('active'),
	ciphertextRef: text('ciphertext_ref').notNull(),
	algorithm: text('algorithm').notNull(),
	wrappingKeyId: text('wrapping_key_id').notNull(),
	createdByClientId: text('created_by_client_id'),
	expiresAt: text('expires_at'),
	migratedTo: text('migrated_to'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	tombstonedAt: text('tombstoned_at'),
}, (table) => [
	index('idx_client_encrypted_escrow_secret').on(table.secretId, table.status),
	index('idx_client_encrypted_escrow_project').on(table.teamId, table.projectId, table.status)
]);
