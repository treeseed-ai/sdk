import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';


export const commonsParticipants = pgTable('commons_participants', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	teamId: text('team_id').notNull(),
	status: text('status').notNull().default('active'),
	displayName: text('display_name'),
	verifiedEmail: integer('verified_email').notNull().default(0),
	baseWeight: real('base_weight').notNull().default(1),
	trustWeight: real('trust_weight').notNull().default(0),
	contributionWeight: real('contribution_weight').notNull().default(0),
	stakeholderWeight: real('stakeholder_weight').notNull().default(0),
	delegatedWeight: real('delegated_weight').notNull().default(0),
	totalWeight: real('total_weight').notNull().default(1),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commons_participants_user').on(table.userId),
	index('idx_commons_participants_team_status').on(table.teamId, table.status, table.updatedAt)
]);

export const commonsQuestions = pgTable('commons_questions', {
	id: text('id').primaryKey(),
	participantId: text('participant_id').notNull(),
	userId: text('user_id').notNull(),
	teamId: text('team_id').notNull(),
	status: text('status').notNull().default('open'),
	title: text('title').notNull(),
	body: text('body').notNull(),
	answer: text('answer'),
	convertedProposalId: text('converted_proposal_id'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commons_questions_status').on(table.status, table.updatedAt),
	index('idx_commons_questions_participant').on(table.participantId, table.status, table.updatedAt)
]);

export const commonsProposals = pgTable('commons_proposals', {
	id: text('id').primaryKey(),
	participantId: text('participant_id').notNull(),
	userId: text('user_id').notNull(),
	teamId: text('team_id').notNull(),
	status: text('status').notNull().default('draft'),
	title: text('title').notNull(),
	summary: text('summary').notNull(),
	body: text('body').notNull(),
	scope: text('scope').notNull().default('treeseed_commons'),
	decisionType: text('decision_type').notNull().default('advisory'),
	contentProposalSlug: text('content_proposal_slug'),
	contentDecisionSlug: text('content_decision_slug'),
	backingCount: integer('backing_count').notNull().default(0),
	voteSupportWeight: real('vote_support_weight').notNull().default(0),
	voteObjectWeight: real('vote_object_weight').notNull().default(0),
	voteAbstainWeight: real('vote_abstain_weight').notNull().default(0),
	qualifiedAt: text('qualified_at'),
	votingStartsAt: text('voting_starts_at'),
	votingEndsAt: text('voting_ends_at'),
	stewardDecisionAt: text('steward_decision_at'),
	stewardDecisionBy: text('steward_decision_by'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commons_proposals_status').on(table.status, table.updatedAt),
	index('idx_commons_proposals_participant').on(table.participantId, table.status, table.updatedAt),
	index('idx_commons_proposals_scope').on(table.scope, table.status, table.updatedAt)
]);

export const commonsWeightSnapshots = pgTable('commons_weight_snapshots', {
	id: text('id').primaryKey(),
	participantId: text('participant_id').notNull(),
	policyVersion: text('policy_version').notNull(),
	baseWeight: real('base_weight').notNull().default(1),
	verifiedEmailWeight: real('verified_email_weight').notNull().default(0),
	accountAgeWeight: real('account_age_weight').notNull().default(0),
	contributionWeight: real('contribution_weight').notNull().default(0),
	stakeholderWeight: real('stakeholder_weight').notNull().default(0),
	trustRoleWeight: real('trust_role_weight').notNull().default(0),
	delegatedWeight: real('delegated_weight').notNull().default(0),
	totalWeight: real('total_weight').notNull().default(1),
	evidenceJson: text('evidence_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_commons_weight_snapshots_participant').on(table.participantId, table.createdAt)
]);

export const commonsProposalBackings = pgTable('commons_proposal_backings', {
	id: text('id').primaryKey(),
	proposalId: text('proposal_id').notNull(),
	participantId: text('participant_id').notNull(),
	userId: text('user_id').notNull(),
	weightSnapshotId: text('weight_snapshot_id').notNull(),
	weight: real('weight').notNull(),
	reason: text('reason'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commons_proposal_backings_once').on(table.proposalId, table.participantId),
	index('idx_commons_proposal_backings_proposal').on(table.proposalId, table.createdAt)
]);

export const commonsProposalVotes = pgTable('commons_proposal_votes', {
	id: text('id').primaryKey(),
	proposalId: text('proposal_id').notNull(),
	participantId: text('participant_id').notNull(),
	userId: text('user_id').notNull(),
	vote: text('vote').notNull(),
	weightSnapshotId: text('weight_snapshot_id').notNull(),
	weight: real('weight').notNull(),
	reason: text('reason'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commons_proposal_votes_once').on(table.proposalId, table.participantId),
	index('idx_commons_proposal_votes_proposal').on(table.proposalId, table.vote, table.updatedAt)
]);

export const commonsDelegations = pgTable('commons_delegations', {
	id: text('id').primaryKey(),
	fromParticipantId: text('from_participant_id').notNull(),
	toParticipantId: text('to_participant_id').notNull(),
	scope: text('scope').notNull().default('treeseed_commons'),
	status: text('status').notNull().default('active'),
	weightLimit: real('weight_limit'),
	reason: text('reason'),
	createdAt: text('created_at').notNull(),
	revokedAt: text('revoked_at'),
}, (table) => [
	uniqueIndex('idx_commons_delegations_active').on(table.fromParticipantId, table.toParticipantId, table.scope, table.status),
	index('idx_commons_delegations_to').on(table.toParticipantId, table.status)
]);

export const commonsDecisions = pgTable('commons_decisions', {
	id: text('id').primaryKey(),
	proposalId: text('proposal_id').notNull(),
	status: text('status').notNull().default('proposed'),
	decisionRecordId: text('decision_record_id'),
	decisionRecordSlug: text('decision_record_slug'),
	title: text('title').notNull(),
	summary: text('summary').notNull(),
	stewardReason: text('steward_reason'),
	capacityBudget: text('capacity_budget'),
	scheduledFor: text('scheduled_for'),
	implementedAt: text('implemented_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commons_decisions_proposal').on(table.proposalId),
	index('idx_commons_decisions_status').on(table.status, table.updatedAt)
]);

export const commonsGovernanceEvents = pgTable('commons_governance_events', {
	id: text('id').primaryKey(),
	eventType: text('event_type').notNull(),
	actorType: text('actor_type').notNull().default('system'),
	actorId: text('actor_id'),
	participantId: text('participant_id'),
	proposalId: text('proposal_id'),
	questionId: text('question_id'),
	decisionId: text('decision_id'),
	priorState: text('prior_state'),
	nextState: text('next_state'),
	message: text('message'),
	evidenceJson: text('evidence_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_commons_governance_events_proposal').on(table.proposalId, table.createdAt),
	index('idx_commons_governance_events_participant').on(table.participantId, table.createdAt),
	index('idx_commons_governance_events_type').on(table.eventType, table.createdAt)
]);

export const teamGovernancePolicies = pgTable('team_governance_policies', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	scope: text('scope').notNull().default('team'),
	providerId: text('provider_id').notNull(),
	providerVersion: text('provider_version').notNull().default('1'),
	configJson: text('config_json').notNull().default('{}'),
	active: integer('active').notNull().default(1),
	createdBy: text('created_by'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	supersededAt: text('superseded_at'),
}, (table) => [
	index('idx_team_governance_policies_team_scope').on(table.teamId, table.scope, table.active)
]);

export const projectGovernancePolicies = pgTable('project_governance_policies', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	providerId: text('provider_id').notNull(),
	providerVersion: text('provider_version').notNull().default('1'),
	configJson: text('config_json').notNull().default('{}'),
	active: integer('active').notNull().default(1),
	createdBy: text('created_by'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	supersededAt: text('superseded_at'),
}, (table) => [
	index('idx_project_governance_policies_project').on(table.projectId, table.active)
]);

export const governanceProposals = pgTable('governance_proposals', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	scope: text('scope').notNull().default('project'),
	status: text('status').notNull().default('draft'),
	title: text('title').notNull(),
	summary: text('summary').notNull(),
	body: text('body').notNull(),
	proposalType: text('proposal_type').notNull().default('implementation'),
	contentProposalSlug: text('content_proposal_slug'),
	contentDecisionSlug: text('content_decision_slug'),
	activeVersion: integer('active_version').notNull().default(1),
	activeContentHash: text('active_content_hash').notNull(),
	governanceProviderId: text('governance_provider_id').notNull(),
	governanceProviderVersion: text('governance_provider_version').notNull().default('1'),
	governancePolicyId: text('governance_policy_id'),
	decisionId: text('decision_id'),
	votingStartsAt: text('voting_starts_at'),
	votingEndsAt: text('voting_ends_at'),
	closedAt: text('closed_at'),
	closedReason: text('closed_reason'),
	createdByType: text('created_by_type').notNull().default('user'),
	createdById: text('created_by_id'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_governance_proposals_team_status').on(table.teamId, table.status, table.updatedAt),
	index('idx_governance_proposals_project_status').on(table.projectId, table.status, table.updatedAt),
	index('idx_governance_proposals_scope_status').on(table.scope, table.status, table.updatedAt),
	index('idx_governance_proposals_content_slug').on(table.contentProposalSlug)
]);

export const governanceProposalVersions = pgTable('governance_proposal_versions', {
	id: text('id').primaryKey(),
	proposalId: text('proposal_id').notNull(),
	version: integer('version').notNull(),
	title: text('title').notNull(),
	summary: text('summary').notNull(),
	body: text('body').notNull(),
	contentHash: text('content_hash').notNull(),
	changeReason: text('change_reason'),
	createdByType: text('created_by_type').notNull().default('user'),
	createdById: text('created_by_id'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	uniqueIndex('idx_governance_proposal_versions_unique').on(table.proposalId, table.version),
	index('idx_governance_proposal_versions_proposal').on(table.proposalId, table.createdAt)
]);
