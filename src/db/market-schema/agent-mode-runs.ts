import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { teams } from './subscribers.ts';
import { projects } from './governance-electorate-snapshots.ts';
import { capacityProviderAssignments, projectAgentClasses } from './capacity-ledger-entries.ts';
import { capacityExecutionProviders, capacityProviders } from './better-auth-account.ts';

export const agentModeRuns = pgTable('agent_mode_runs', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	providerAssignmentId: text('provider_assignment_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	executionProviderId: text('execution_provider_id'),
	projectAgentClassId: text('project_agent_class_id').notNull(),
	agentId: text('agent_id'),
	handlerId: text('handler_id'),
	mode: text('mode').notNull(),
	status: text('status').notNull().default('queued'),
	selectedInputJson: text('selected_input_json').notNull().default('{}'),
	capacityEnvelopeJson: text('capacity_envelope_json').notNull().default('{}'),
	outputsJson: text('outputs_json').notNull().default('{}'),
	traceRefsJson: text('trace_refs_json').notNull().default('{}'),
	usageActualJson: text('usage_actual_json').notNull().default('{}'),
	validationJson: text('validation_json').notNull().default('{}'),
	fallbackReason: text('fallback_reason'),
	startedAt: text('started_at'),
	completedAt: text('completed_at'),
	failedAt: text('failed_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_agent_mode_runs_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_agent_mode_runs_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_agent_mode_runs_assignment', columns: [table.providerAssignmentId], foreignColumns: [capacityProviderAssignments.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_agent_mode_runs_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_agent_mode_runs_execution_provider', columns: [table.capacityProviderId, table.executionProviderId], foreignColumns: [capacityExecutionProviders.capacityProviderId, capacityExecutionProviders.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_agent_mode_runs_agent_class', columns: [table.projectAgentClassId], foreignColumns: [projectAgentClasses.id] }).onDelete('restrict'),
	index('idx_agent_mode_runs_assignment').on(table.providerAssignmentId, table.status),
	index('idx_agent_mode_runs_project_mode').on(table.projectId, table.mode, table.createdAt),
	index('idx_agent_mode_runs_provider').on(table.capacityProviderId, table.createdAt),
	check('chk_agent_mode_runs_mode', sql`${table.mode} IN ('planning', 'acting')`),
	check('chk_agent_mode_runs_status', sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')`)
]);

export const agentFallbackOutputs = pgTable('agent_fallback_outputs', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	assignmentId: text('assignment_id'),
	mode: text('mode').notNull(),
	code: text('code').notNull(),
	status: text('status').notNull().default('draft'),
	outputJson: text('output_json').notNull().default('{}'),
	provenanceJson: text('provenance_json').notNull().default('{}'),
	quotaJson: text('quota_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_agent_fallback_outputs_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_agent_fallback_outputs_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_agent_fallback_outputs_assignment', columns: [table.assignmentId], foreignColumns: [capacityProviderAssignments.id] }).onDelete('restrict'),
	index('idx_agent_fallback_outputs_project_created').on(table.projectId, table.createdAt),
	index('idx_agent_fallback_outputs_project_mode_status').on(table.projectId, table.mode, table.status, table.createdAt),
	index('idx_agent_fallback_outputs_assignment').on(table.assignmentId, table.createdAt)
]);

export const decisionPlanningStatuses = pgTable('decision_planning_statuses', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	decisionId: text('decision_id').notNull(),
	humanApprovalState: text('human_approval_state'),
	executionReadiness: text('execution_readiness').notNull().default('draft'),
	planningInputsStatus: text('planning_inputs_status').notNull().default('requested'),
	scopeHash: text('scope_hash').notNull(),
	staleReason: text('stale_reason'),
	readyAt: text('ready_at'),
	staleAt: text('stale_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_decision_planning_statuses_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_decision_planning_statuses_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('cascade'),
	uniqueIndex('idx_decision_planning_statuses_decision').on(table.decisionId),
	index('idx_decision_planning_statuses_project').on(table.projectId, table.executionReadiness, table.updatedAt),
	check('chk_decision_planning_statuses_readiness', sql`${table.executionReadiness} IN ('draft','blocked','ready','stale','waived')`),
	check('chk_decision_planning_statuses_inputs', sql`${table.planningInputsStatus} IN ('requested','complete','waived','rejected','stale')`)
]);

export const planningInputRequests = pgTable('planning_input_requests', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	decisionId: text('decision_id').notNull(),
	projectAgentClassId: text('project_agent_class_id'),
	mode: text('mode').notNull().default('planning'),
	status: text('status').notNull().default('requested'),
	scopeHash: text('scope_hash').notNull(),
	prompt: text('prompt'),
	responseJson: text('response_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	requestedAt: text('requested_at').notNull(),
	completedAt: text('completed_at'),
	staleAt: text('stale_at'),
}, (table) => [
	foreignKey({ name: 'fk_planning_input_requests_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_planning_input_requests_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_planning_input_requests_agent_class', columns: [table.projectAgentClassId], foreignColumns: [projectAgentClasses.id] }).onDelete('restrict'),
	index('idx_planning_input_requests_decision').on(table.decisionId, table.status, table.requestedAt),
	index('idx_planning_input_requests_project').on(table.projectId, table.status, table.requestedAt),
	check('chk_planning_input_requests_mode', sql`${table.mode} IN ('planning','acting')`),
	check('chk_planning_input_requests_status', sql`${table.status} IN ('requested','complete','waived','rejected','stale')`)
]);

export const decisionExecutionInputs = pgTable('decision_execution_inputs', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	decisionId: text('decision_id').notNull(),
	workGraphNodeId: text('work_graph_node_id'),
	projectAgentClassId: text('project_agent_class_id').notNull(),
	mode: text('mode').notNull().default('acting'),
	status: text('status').notNull().default('proposed'),
	scopeHash: text('scope_hash').notNull(),
	inputJson: text('input_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	acceptedAt: text('accepted_at'),
	revisionRequestedAt: text('revision_requested_at'),
	staleAt: text('stale_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_decision_execution_inputs_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_decision_execution_inputs_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_decision_execution_inputs_agent_class', columns: [table.projectAgentClassId], foreignColumns: [projectAgentClasses.id] }).onDelete('restrict'),
	index('idx_decision_execution_inputs_decision').on(table.decisionId, table.status, table.createdAt),
	index('idx_decision_execution_inputs_graph_node').on(table.decisionId, table.workGraphNodeId, table.status),
	uniqueIndex('idx_decision_execution_inputs_graph_scope').on(table.decisionId, table.workGraphNodeId, table.scopeHash).where(sql`${table.workGraphNodeId} IS NOT NULL`),
	index('idx_decision_execution_inputs_project').on(table.projectId, table.status, table.mode, table.createdAt),
	check('chk_decision_execution_inputs_mode', sql`${table.mode} IN ('planning','acting')`),
	check('chk_decision_execution_inputs_status', sql`${table.status} IN ('proposed','accepted','revision_requested','rejected','stale')`)
]);

export const structuredAgentEstimates = pgTable('structured_agent_estimates', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	decisionId: text('decision_id'),
	proposalId: text('proposal_id'),
	workUnitId: text('work_unit_id'),
	agentClass: text('agent_class').notNull(),
	agentId: text('agent_id'),
	status: text('status').notNull().default('submitted'),
	estimateJson: text('estimate_json').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	acceptedAt: text('accepted_at'),
	rejectedAt: text('rejected_at'),
}, (table) => [
	foreignKey({ name: 'fk_structured_agent_estimates_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_structured_agent_estimates_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('cascade'),
	index('idx_structured_agent_estimates_decision').on(table.decisionId, table.status, table.createdAt),
	check('chk_structured_agent_estimates_status', sql`${table.status} IN ('submitted','accepted','rejected','superseded')`)
]);

export const decisionAssignmentGraphs = pgTable('decision_assignment_graphs', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	decisionId: text('decision_id').notNull(),
	version: integer('version').notNull(),
	status: text('status').notNull(),
	active: integer('active').notNull().default(0),
	graphJson: text('graph_json').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	compiledAt: text('compiled_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_decision_assignment_graphs_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_decision_assignment_graphs_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('cascade'),
	uniqueIndex('idx_decision_assignment_graphs_version').on(table.decisionId, table.version),
	uniqueIndex('idx_decision_assignment_graphs_one_active').on(table.decisionId).where(sql`${table.active} = 1`),
	index('idx_decision_assignment_graphs_decision').on(table.decisionId, table.active, table.version),
	check('chk_decision_assignment_graphs_version', sql`${table.version} >= 1`),
	check('chk_decision_assignment_graphs_status', sql`${table.status} IN ('draft','compiled','ready','executing','completed','blocked')`),
	check('chk_decision_assignment_graphs_active', sql`${table.active} IN (0,1)`)
]);

export const researchWorkflows = pgTable('research_workflows', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	objectiveRef: text('objective_ref').notNull(),
	questionRef: text('question_ref').notNull(),
	status: text('status').notNull(),
	stateVersion: integer('state_version').notNull(),
	workflowJson: text('workflow_json').notNull(),
	idempotencyKey: text('idempotency_key').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_research_workflows_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_research_workflows_project', columns: [table.projectId], foreignColumns: [projects.id] }),
	uniqueIndex('idx_research_workflows_idempotency').on(table.projectId, table.idempotencyKey),
	index('idx_research_workflows_question').on(table.projectId, table.questionRef, table.status, table.updatedAt),
	check('chk_research_workflows_status', sql`${table.status} IN ('ready','running','completed','blocked','failed')`),
	check('chk_research_workflows_state_version', sql`${table.stateVersion} >= 1`)
]);

export const deliverableContracts = pgTable('deliverable_contracts', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	decisionId: text('decision_id').notNull(),
	deliverableType: text('deliverable_type').notNull(),
	status: text('status').notNull(),
	contractJson: text('contract_json').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_deliverable_contracts_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_deliverable_contracts_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('cascade'),
	index('idx_deliverable_contracts_decision').on(table.decisionId, table.status, table.deliverableType),
	check('chk_deliverable_contracts_status', sql`${table.status} IN ('required','draft','submitted','approved','rejected')`)
]);

export const deliverableManifests = pgTable('deliverable_manifests', {
	id: text('id').primaryKey(),
	deliverableContractId: text('deliverable_contract_id').notNull(),
	projectId: text('project_id').notNull(),
	decisionId: text('decision_id').notNull(),
	readyForReview: integer('ready_for_review').notNull().default(0),
	manifestJson: text('manifest_json').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	submittedAt: text('submitted_at'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_deliverable_manifests_contract', columns: [table.deliverableContractId], foreignColumns: [deliverableContracts.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_deliverable_manifests_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('cascade'),
	index('idx_deliverable_manifests_contract').on(table.deliverableContractId, table.submittedAt),
	check('chk_deliverable_manifests_ready', sql`${table.readyForReview} IN (0,1)`)
]);

export const capacityWorkdayRuns = pgTable('capacity_workday_runs', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	capacityProviderId: text('capacity_provider_id'),
	scenarioId: text('scenario_id').notNull().default('portfolio-local'),
	status: text('status').notNull().default('queued'),
	environment: text('environment').notNull().default('local'),
	requestedById: text('requested_by_id'),
	parametersJson: text('parameters_json').notNull().default('{}'),
	summaryJson: text('summary_json').notNull().default('{}'),
	metricsJson: text('metrics_json').notNull().default('{}'),
	expectedJson: text('expected_json').notNull().default('{}'),
	actualJson: text('actual_json').notNull().default('{}'),
	reportRefsJson: text('report_refs_json').notNull().default('{}'),
	errorJson: text('error_json').notNull().default('{}'),
	startedAt: text('started_at'),
	completedAt: text('completed_at'),
	nextEventIndex: integer('next_event_index').notNull().default(0),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_workday_runs_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	index('idx_capacity_workday_runs_team_status').on(table.teamId, table.status, table.updatedAt),
	index('idx_capacity_workday_runs_provider').on(table.capacityProviderId, table.updatedAt),
	check('chk_capacity_workday_runs_status', sql`${table.status} IN ('queued','running','completed','cancelled','failed','degraded')`),
	check('chk_capacity_workday_runs_next_event', sql`${table.nextEventIndex} >= 0`)
]);
