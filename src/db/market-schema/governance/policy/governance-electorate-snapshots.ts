import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';


export const governanceElectorateSnapshots = pgTable('governance_electorate_snapshots', {
	id: text('id').primaryKey(),
	proposalId: text('proposal_id').notNull(),
	proposalVersion: integer('proposal_version').notNull(),
	providerId: text('provider_id').notNull(),
	providerVersion: text('provider_version').notNull().default('1'),
	ruleSnapshotJson: text('rule_snapshot_json').notNull().default('{}'),
	chambersJson: text('chambers_json').notNull().default('[]'),
	eligibleVotersJson: text('eligible_voters_json').notNull().default('[]'),
	delegationsJson: text('delegations_json').notNull().default('[]'),
	eligibleWeightTotal: real('eligible_weight_total').notNull().default(0),
	activeWeightTotal: real('active_weight_total').notNull().default(0),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_governance_electorate_snapshots_proposal').on(table.proposalId, table.proposalVersion)
]);

export const governanceProposalVotes = pgTable('governance_proposal_votes', {
	id: text('id').primaryKey(),
	proposalId: text('proposal_id').notNull(),
	proposalVersion: integer('proposal_version').notNull(),
	userId: text('user_id').notNull(),
	vote: text('vote').notNull(),
	reason: text('reason'),
	chamberVotesJson: text('chamber_votes_json').notNull().default('{}'),
	effectiveWeightsJson: text('effective_weights_json').notNull().default('{}'),
	delegatedFromJson: text('delegated_from_json').notNull().default('[]'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_governance_proposal_votes_once').on(table.proposalId, table.proposalVersion, table.userId),
	index('idx_governance_proposal_votes_proposal').on(table.proposalId, table.proposalVersion, table.vote)
]);

export const governanceVoteEvents = pgTable('governance_vote_events', {
	id: text('id').primaryKey(),
	proposalId: text('proposal_id').notNull(),
	proposalVersion: integer('proposal_version').notNull(),
	userId: text('user_id').notNull(),
	priorVote: text('prior_vote'),
	nextVote: text('next_vote').notNull(),
	reason: text('reason'),
	effectiveWeightsJson: text('effective_weights_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_governance_vote_events_proposal').on(table.proposalId, table.proposalVersion, table.createdAt)
]);

export const governanceDelegations = pgTable('governance_delegations', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	scope: text('scope').notNull().default('team'),
	fromUserId: text('from_user_id').notNull(),
	toUserId: text('to_user_id').notNull(),
	chambersJson: text('chambers_json').notNull().default('[]'),
	status: text('status').notNull().default('active'),
	reason: text('reason'),
	createdAt: text('created_at').notNull(),
	revokedAt: text('revoked_at'),
	expiresAt: text('expires_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
}, (table) => [
	index('idx_governance_delegations_team_status').on(table.teamId, table.status),
	index('idx_governance_delegations_from').on(table.fromUserId, table.status),
	index('idx_governance_delegations_to').on(table.toUserId, table.status)
]);

export const governanceDecisions = pgTable('governance_decisions', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	proposalId: text('proposal_id').notNull(),
	proposalVersion: integer('proposal_version').notNull(),
	proposalContentHash: text('proposal_content_hash').notNull(),
	status: text('status').notNull().default('creating'),
	title: text('title').notNull(),
	summary: text('summary').notNull(),
	contentDecisionSlug: text('content_decision_slug'),
	governanceProviderId: text('governance_provider_id').notNull(),
	governanceRuleJson: text('governance_rule_json').notNull().default('{}'),
	electorateSnapshotId: text('electorate_snapshot_id'),
	voteResultJson: text('vote_result_json').notNull().default('{}'),
	voterReasonsJson: text('voter_reasons_json').notNull().default('[]'),
	proposalSnapshotJson: text('proposal_snapshot_json').notNull().default('{}'),
	decisionRecordJson: text('decision_record_json').notNull().default('{}'),
	createdByType: text('created_by_type').notNull().default('system'),
	createdById: text('created_by_id'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	supersededAt: text('superseded_at'),
}, (table) => [
	uniqueIndex('idx_governance_decisions_proposal').on(table.proposalId),
	index('idx_governance_decisions_project_status').on(table.projectId, table.status, table.updatedAt)
]);

export const governanceEvents = pgTable('governance_events', {
	id: text('id').primaryKey(),
	eventType: text('event_type').notNull(),
	actorType: text('actor_type').notNull().default('system'),
	actorId: text('actor_id'),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	proposalId: text('proposal_id'),
	decisionId: text('decision_id'),
	proposalVersion: integer('proposal_version'),
	priorState: text('prior_state'),
	nextState: text('next_state'),
	message: text('message'),
	evidenceJson: text('evidence_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_governance_events_proposal').on(table.proposalId, table.createdAt),
	index('idx_governance_events_decision').on(table.decisionId, table.createdAt),
	index('idx_governance_events_team').on(table.teamId, table.createdAt),
	index('idx_governance_events_project').on(table.projectId, table.createdAt)
]);

export const projects = pgTable('projects', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	slug: text('slug').notNull(),
	name: text('name').notNull(),
	description: text('description'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_projects_team_slug').on(table.teamId, table.slug),
	index('idx_projects_team_id').on(table.teamId)
]);

export const projectConnections = pgTable('project_connections', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull().unique(),
	mode: text('mode').notNull(),
	projectApiBaseUrl: text('project_api_base_url'),
	executionOwner: text('execution_owner').notNull(),
	runnerRegistrationState: text('runner_registration_state').notNull().default('pending'),
	runnerKeyPrefix: text('runner_key_prefix'),
	runnerKeyHash: text('runner_key_hash'),
	runnerRegisteredAt: text('runner_registered_at'),
	runnerLastSeenAt: text('runner_last_seen_at'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const projectCapabilityGrants = pgTable('project_capability_grants', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	label: text('label'),
	namespace: text('namespace').notNull(),
	operation: text('operation').notNull(),
	executionClass: text('execution_class').notNull(),
	allowedTargetsJson: text('allowed_targets_json').notNull(),
	defaultDispatchMode: text('default_dispatch_mode').notNull(),
	approvalPolicyJson: text('approval_policy_json').notNull().default('{}'),
	resourceScopeJson: text('resource_scope_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	enabled: integer('enabled').notNull().default(1),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_project_capability_grants_project_operation').on(table.projectId, table.namespace, table.operation)
]);

export const teamApiKeys = pgTable('team_api_keys', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	name: text('name').notNull(),
	keyPrefix: text('key_prefix').notNull(),
	keyHash: text('key_hash').notNull(),
	permissionsJson: text('permissions_json').notNull(),
	expiresAt: text('expires_at'),
	lastUsedAt: text('last_used_at'),
	revokedAt: text('revoked_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_team_api_keys_prefix').on(table.keyPrefix)
]);

export const entitlements = pgTable('entitlements', {
	id: text('id').primaryKey(),
	teamId: text('team_id'),
	projectId: text('project_id'),
	tier: text('tier').notNull(),
	status: text('status').notNull(),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_entitlements_project').on(table.projectId)
]);

export const remoteJobs = pgTable('remote_jobs', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	namespace: text('namespace').notNull(),
	operation: text('operation').notNull(),
	status: text('status').notNull(),
	preferredMode: text('preferred_mode').notNull(),
	selectedTarget: text('selected_target').notNull(),
	capabilityJson: text('capability_json').notNull(),
	inputJson: text('input_json').notNull(),
	outputJson: text('output_json'),
	errorJson: text('error_json'),
	requestedByType: text('requested_by_type').notNull(),
	requestedById: text('requested_by_id'),
	assignedRunnerId: text('assigned_runner_id'),
	idempotencyKey: text('idempotency_key'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	startedAt: text('started_at'),
	finishedAt: text('finished_at'),
	cancelledAt: text('cancelled_at'),
}, (table) => [
	index('idx_remote_jobs_project_status').on(table.projectId, table.status, table.createdAt),
	index('idx_remote_jobs_project_idempotency').on(table.projectId, table.idempotencyKey)
]);

export const remoteJobEvents = pgTable('remote_job_events', {
	id: text('id').primaryKey(),
	jobId: text('job_id').notNull(),
	seq: integer('seq').notNull(),
	kind: text('kind').notNull(),
	dataJson: text('data_json'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	uniqueIndex('idx_remote_job_events_job_seq').on(table.jobId, table.seq)
]);

export const knowledgePacks = pgTable('knowledge_packs', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	summary: text('summary'),
	sourceKind: text('source_kind').notNull(),
	sourceRef: text('source_ref'),
	installStrategy: text('install_strategy').notNull(),
	visibility: text('visibility').notNull(),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_knowledge_packs_team_id').on(table.teamId)
]);

export const teamStorageLocators = pgTable('team_storage_locators', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull().unique(),
	bucketName: text('bucket_name').notNull(),
	manifestKeyTemplate: text('manifest_key_template').notNull(),
	previewRootTemplate: text('preview_root_template').notNull(),
	publicBaseUrl: text('public_base_url'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});
