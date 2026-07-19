import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';

// Source of truth for the Treeseed Treeseed PostgreSQL control-plane schema.
// Regenerate the checked-in Market Drizzle SQL with npm run db:generate:market.

export const subscribers = pgTable('subscribers', {
	email: text('email').primaryKey(),
	createdAt: text('created_at').notNull(),
});

export const agentRuns = pgTable('agent_runs', {
	runId: text('run_id').primaryKey(),
	agentSlug: text('agent_slug').notNull(),
	status: text('status').notNull(),
	createdAt: text('created_at').notNull(),
});

export const agentMessages = pgTable('agent_messages', {
	id: serial('id').primaryKey(),
	typeColumn: text('type').notNull(),
	payloadJson: text('payload_json').notNull(),
	createdAt: text('created_at').notNull(),
});

export const contactSubmissions = pgTable('contact_submissions', {
	id: serial('id').primaryKey(),
	email: text('email').notNull(),
	message: text('message').notNull(),
	createdAt: text('created_at').notNull(),
});

export const runtimeEnvelopes = pgTable('runtime_envelopes', {
	id: serial('id').primaryKey(),
	recordType: text('record_type').notNull(),
	payloadJson: text('payload_json').notNull(),
	createdAt: text('created_at').notNull(),
});

export const users = pgTable('users', {
	id: text('id').primaryKey(),
	email: text('email'),
	displayName: text('display_name'),
	status: text('status').notNull().default('active'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	username: text('username'),
}, (table) => [
	uniqueIndex('idx_users_username').on(table.username)
]);

export const userIdentities = pgTable('user_identities', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	provider: text('provider').notNull(),
	providerSubject: text('provider_subject').notNull(),
	email: text('email'),
	emailVerified: integer('email_verified').notNull().default(0),
	profileJson: text('profile_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_user_identities_provider_subject').on(table.provider, table.providerSubject)
]);

export const userEmailAddresses = pgTable('user_email_addresses', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	email: text('email').notNull(),
	normalizedEmail: text('normalized_email').notNull().unique(),
	status: text('status').notNull().default('pending'),
	isPrimary: integer('is_primary').notNull().default(0),
	verificationRequestedAt: text('verification_requested_at'),
	verifiedAt: text('verified_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_user_email_addresses_user').on(table.userId, table.status, table.isPrimary),
	uniqueIndex('idx_user_email_addresses_normalized').on(table.normalizedEmail)
]);

export const roles = pgTable('roles', {
	id: text('id').primaryKey(),
	keyColumn: text('key').notNull().unique(),
	description: text('description'),
	createdAt: text('created_at').notNull(),
});

export const permissions = pgTable('permissions', {
	id: text('id').primaryKey(),
	keyColumn: text('key').notNull().unique(),
	resource: text('resource').notNull(),
	action: text('action').notNull(),
	scope: text('scope').notNull(),
	description: text('description'),
	createdAt: text('created_at').notNull(),
});

export const rolePermissions = pgTable('role_permissions', {
	roleId: text('role_id'),
	permissionId: text('permission_id'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	primaryKey({ columns: [table.roleId, table.permissionId] })
]);

export const userRoleBindings = pgTable('user_role_bindings', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	roleId: text('role_id').notNull(),
	createdAt: text('created_at').notNull(),
}, (table) => [
	uniqueIndex('idx_user_role_bindings_user_role').on(table.userId, table.roleId)
]);

export const apiTokens = pgTable('api_tokens', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	kind: text('kind').notNull(),
	name: text('name').notNull(),
	tokenPrefix: text('token_prefix').notNull(),
	tokenHash: text('token_hash').notNull(),
	scopesJson: text('scopes_json').notNull(),
	expiresAt: text('expires_at'),
	lastUsedAt: text('last_used_at'),
	revokedAt: text('revoked_at'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_api_tokens_user_id').on(table.userId),
	index('idx_api_tokens_prefix').on(table.tokenPrefix)
]);

export const serviceCredentials = pgTable('service_credentials', {
	id: text('id').primaryKey(),
	serviceId: text('service_id').notNull().unique(),
	name: text('name').notNull(),
	secretHash: text('secret_hash').notNull(),
	rolesJson: text('roles_json').notNull(),
	permissionsJson: text('permissions_json').notNull(),
	revokedAt: text('revoked_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	lastUsedAt: text('last_used_at'),
});

export const authSessions = pgTable('auth_sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	sessionType: text('session_type').notNull(),
	refreshTokenHash: text('refresh_token_hash').notNull(),
	scopesJson: text('scopes_json').notNull(),
	expiresAt: text('expires_at').notNull(),
	revokedAt: text('revoked_at'),
	dataJson: text('data_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_auth_sessions_user_id').on(table.userId)
]);

export const auditEvents = pgTable('audit_events', {
	id: text('id').primaryKey(),
	actorType: text('actor_type').notNull(),
	actorId: text('actor_id'),
	eventType: text('event_type').notNull(),
	targetType: text('target_type'),
	targetId: text('target_id'),
	dataJson: text('data_json'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_audit_events_target').on(table.targetType, table.targetId)
]);

export const deviceCodes = pgTable('device_codes', {
	id: text('id').primaryKey(),
	deviceCode: text('device_code').notNull().unique(),
	userCode: text('user_code').notNull().unique(),
	requestedScopesJson: text('requested_scopes_json').notNull(),
	expiresAt: text('expires_at').notNull(),
	intervalSeconds: integer('interval_seconds').notNull(),
	status: text('status').notNull(),
	userId: text('user_id'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const teams = pgTable('teams', {
	id: text('id').primaryKey(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	displayName: text('display_name'),
	logoUrl: text('logo_url'),
	profileSummary: text('profile_summary'),
}, (table) => [
	uniqueIndex('idx_teams_name').on(table.name)
]);

export const teamMemberships = pgTable('team_memberships', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	userId: text('user_id').notNull(),
	status: text('status').notNull().default('active'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_team_memberships_team_user').on(table.teamId, table.userId)
]);

export const teamRoleBindings = pgTable('team_role_bindings', {
	id: text('id').primaryKey(),
	teamMembershipId: text('team_membership_id').notNull(),
	roleId: text('role_id').notNull(),
	createdAt: text('created_at').notNull(),
});

export const webSessions = pgTable('web_sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	identityId: text('identity_id'),
	betterAuthSessionId: text('better_auth_session_id'),
	provider: text('provider').notNull(),
	providerSubject: text('provider_subject').notNull(),
	email: text('email'),
	displayName: text('display_name'),
	principalJson: text('principal_json').notNull(),
	csrfToken: text('csrf_token').notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	authenticatedAt: text('authenticated_at').notNull(),
	lastSeenAt: text('last_seen_at'),
	expiresAt: text('expires_at').notNull(),
	revokedAt: text('revoked_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_web_sessions_user_id').on(table.userId)
]);

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

export const catalogItems = pgTable('catalog_items', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	kind: text('kind').notNull(),
	slug: text('slug').notNull(),
	title: text('title').notNull(),
	summary: text('summary'),
	visibility: text('visibility').notNull(),
	listingEnabled: integer('listing_enabled').notNull().default(0),
	offerMode: text('offer_mode').notNull(),
	manifestKey: text('manifest_key'),
	artifactKey: text('artifact_key'),
	searchText: text('search_text'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_catalog_items_team_kind_slug').on(table.teamId, table.kind, table.slug),
	index('idx_catalog_items_team_kind').on(table.teamId, table.kind, table.updatedAt),
	index('idx_catalog_items_visibility_listing').on(table.visibility, table.listingEnabled, table.updatedAt)
]);

export const catalogArtifactVersions = pgTable('catalog_artifact_versions', {
	id: text('id').primaryKey(),
	itemId: text('item_id').notNull(),
	teamId: text('team_id').notNull(),
	kind: text('kind').notNull(),
	version: text('version').notNull(),
	contentKey: text('content_key').notNull(),
	manifestKey: text('manifest_key'),
	metadataJson: text('metadata_json'),
	publishedAt: text('published_at').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_catalog_artifact_versions_item_version').on(table.itemId, table.version),
	index('idx_catalog_artifact_versions_team_kind').on(table.teamId, table.kind, table.publishedAt)
]);

export const catalogItemCollaborators = pgTable('catalog_item_collaborators', {
	id: text('id').primaryKey(),
	itemId: text('item_id').notNull(),
	subjectType: text('subject_type').notNull(),
	subjectId: text('subject_id').notNull(),
	role: text('role').notNull(),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_catalog_item_collaborators_subject_role').on(table.itemId, table.subjectType, table.subjectId, table.role)
]);

export const commerceVendors = pgTable('commerce_vendors', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	displayName: text('display_name').notNull(),
	slug: text('slug').notNull(),
	status: text('status').notNull().default('submitted'),
	trustLevel: text('trust_level').notNull().default('public_publisher'),
	professionalEntitlementId: text('professional_entitlement_id'),
	stripeAccountId: text('stripe_account_id'),
	salesEnabled: integer('sales_enabled').notNull().default(0),
	serviceSalesEnabled: integer('service_sales_enabled').notNull().default(0),
	capacityListingsEnabled: integer('capacity_listings_enabled').notNull().default(0),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_vendors_team_id').on(table.teamId),
	uniqueIndex('idx_commerce_vendors_slug').on(table.slug),
	index('idx_commerce_vendors_status').on(table.status, table.updatedAt),
	index('idx_commerce_vendors_trust_level').on(table.trustLevel, table.updatedAt)
]);

export const commerceVendorStripeAccounts = pgTable('commerce_vendor_stripe_accounts', {
	id: text('id').primaryKey(),
	vendorId: text('vendor_id').notNull(),
	teamId: text('team_id').notNull(),
	environment: text('environment').notNull().default('test'),
	stripeAccountId: text('stripe_account_id').notNull(),
	accountStatus: text('account_status').notNull().default('pending'),
	onboardingStatus: text('onboarding_status').notNull().default('not_started'),
	chargesEnabled: integer('charges_enabled').notNull().default(0),
	payoutsEnabled: integer('payouts_enabled').notNull().default(0),
	detailsSubmitted: integer('details_submitted').notNull().default(0),
	requirementsCurrentlyDueJson: text('requirements_currently_due_json').notNull().default('[]'),
	requirementsEventuallyDueJson: text('requirements_eventually_due_json').notNull().default('[]'),
	requirementsPastDueJson: text('requirements_past_due_json').notNull().default('[]'),
	requirementsDisabledReason: text('requirements_disabled_reason'),
	capabilitiesJson: text('capabilities_json').notNull().default('{}'),
	onboardingStartedAt: text('onboarding_started_at'),
	onboardingCompletedAt: text('onboarding_completed_at'),
	lastSyncedAt: text('last_synced_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_vendor_stripe_accounts_vendor_env').on(table.vendorId, table.environment),
	uniqueIndex('idx_commerce_vendor_stripe_accounts_stripe_env').on(table.stripeAccountId, table.environment),
	index('idx_commerce_vendor_stripe_accounts_team_env').on(table.teamId, table.environment),
	index('idx_commerce_vendor_stripe_accounts_status').on(table.accountStatus, table.updatedAt)
]);

export const commerceProducts = pgTable('commerce_products', {
	id: text('id').primaryKey(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	kind: text('kind').notNull(),
	slug: text('slug').notNull(),
	title: text('title').notNull(),
	summary: text('summary'),
	description: text('description'),
	status: text('status').notNull().default('draft'),
	visibility: text('visibility').notNull().default('private'),
	catalogItemId: text('catalog_item_id'),
	currentVersionId: text('current_version_id'),
	ownershipModel: text('ownership_model').notNull().default('team_owned'),
	ownershipRecordId: text('ownership_record_id'),
	supportPolicy: text('support_policy'),
	license: text('license'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_products_team_kind_slug').on(table.sellerTeamId, table.kind, table.slug),
	index('idx_commerce_products_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_products_catalog_item').on(table.catalogItemId),
	index('idx_commerce_products_ownership_model').on(table.ownershipModel, table.updatedAt)
]);

export const commerceOwnershipRecords = pgTable('commerce_ownership_records', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	model: text('model').notNull(),
	canonicalOwnerType: text('canonical_owner_type').notNull(),
	canonicalOwnerId: text('canonical_owner_id'),
	sellerTeamId: text('seller_team_id').notNull(),
	stewardTeamId: text('steward_team_id'),
	governancePolicyId: text('governance_policy_id'),
	publicSummary: text('public_summary'),
	buyerVisible: integer('buyer_visible').notNull().default(1),
	effectiveAt: text('effective_at').notNull(),
	supersededAt: text('superseded_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_ownership_product_effective').on(table.productId, table.effectiveAt),
	index('idx_commerce_ownership_seller_effective').on(table.sellerTeamId, table.effectiveAt),
	index('idx_commerce_ownership_model_effective').on(table.model, table.effectiveAt)
]);

export const commerceStewardshipAssignments = pgTable('commerce_stewardship_assignments', {
	id: text('id').primaryKey(),
	ownershipRecordId: text('ownership_record_id').notNull(),
	productId: text('product_id').notNull(),
	role: text('role').notNull(),
	assigneeType: text('assignee_type').notNull(),
	assigneeId: text('assignee_id'),
	displayName: text('display_name'),
	responsibilitiesJson: text('responsibilities_json').notNull().default('[]'),
	visibleToBuyers: integer('visible_to_buyers').notNull().default(1),
	startsAt: text('starts_at').notNull(),
	endsAt: text('ends_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_stewards_product_role').on(table.productId, table.role),
	index('idx_commerce_stewards_ownership_role').on(table.ownershipRecordId, table.role),
	index('idx_commerce_stewards_assignee').on(table.assigneeType, table.assigneeId)
]);

export const commerceContributions = pgTable('commerce_contributions', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	productVersionId: text('product_version_id'),
	contributorType: text('contributor_type').notNull(),
	contributorId: text('contributor_id'),
	displayName: text('display_name'),
	role: text('role').notNull(),
	summary: text('summary'),
	attributionVisibility: text('attribution_visibility').notNull().default('public'),
	agreementRef: text('agreement_ref'),
	benefitWeight: real('benefit_weight'),
	effectiveAt: text('effective_at').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_contributions_product_effective').on(table.productId, table.effectiveAt),
	index('idx_commerce_contributions_version_effective').on(table.productVersionId, table.effectiveAt),
	index('idx_commerce_contributions_contributor').on(table.contributorType, table.contributorId)
]);

export const commerceGovernancePolicies = pgTable('commerce_governance_policies', {
	id: text('id').primaryKey(),
	productId: text('product_id'),
	teamId: text('team_id'),
	policyKind: text('policy_kind').notNull(),
	title: text('title').notNull(),
	approvalRulesJson: text('approval_rules_json').notNull().default('{}'),
	quorumRulesJson: text('quorum_rules_json').notNull().default('{}'),
	buyerVisibleSummary: text('buyer_visible_summary'),
	status: text('status').notNull().default('draft'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_governance_policies_product').on(table.productId, table.status),
	index('idx_commerce_governance_policies_team').on(table.teamId, table.policyKind, table.status)
]);

export const commerceOwnershipTransfers = pgTable('commerce_ownership_transfers', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	fromOwnershipRecordId: text('from_ownership_record_id').notNull(),
	toOwnershipRecordId: text('to_ownership_record_id').notNull(),
	status: text('status').notNull().default('draft'),
	reason: text('reason').notNull(),
	approvalEvidenceJson: text('approval_evidence_json').notNull().default('{}'),
	buyerVisibleImpact: text('buyer_visible_impact'),
	effectiveAt: text('effective_at').notNull(),
	requestedByType: text('requested_by_type').notNull().default('user'),
	requestedById: text('requested_by_id').notNull().default('system'),
	approvedByType: text('approved_by_type'),
	approvedById: text('approved_by_id'),
	approvedAt: text('approved_at'),
	rejectedAt: text('rejected_at'),
	supersededAt: text('superseded_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_commerce_ownership_transfers_product').on(table.productId, table.effectiveAt),
	index('idx_commerce_ownership_transfers_product_status').on(table.productId, table.status, table.effectiveAt),
	index('idx_commerce_ownership_transfers_from_status').on(table.fromOwnershipRecordId, table.status),
	index('idx_commerce_ownership_transfers_to_status').on(table.toOwnershipRecordId, table.status)
]);

export const commerceSuccessionEvents = pgTable('commerce_succession_events', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	ownershipRecordId: text('ownership_record_id'),
	stewardshipAssignmentId: text('stewardship_assignment_id'),
	successorType: text('successor_type').notNull(),
	successorId: text('successor_id').notNull(),
	eventType: text('event_type').notNull(),
	status: text('status').notNull().default('submitted'),
	reason: text('reason'),
	evidenceJson: text('evidence_json').notNull().default('{}'),
	effectiveAt: text('effective_at'),
	createdByType: text('created_by_type').notNull(),
	createdById: text('created_by_id').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_commerce_succession_events_product').on(table.productId, table.eventType, table.createdAt),
	index('idx_commerce_succession_events_ownership').on(table.ownershipRecordId, table.eventType),
	index('idx_commerce_succession_events_successor').on(table.successorType, table.successorId)
]);

export const commerceProductVersions = pgTable('commerce_product_versions', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	version: text('version').notNull(),
	status: text('status').notNull().default('draft'),
	catalogArtifactVersionId: text('catalog_artifact_version_id'),
	manifestKey: text('manifest_key'),
	artifactKey: text('artifact_key'),
	integrity: text('integrity'),
	releaseNotes: text('release_notes'),
	compatibilityJson: text('compatibility_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	publishedAt: text('published_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_product_versions_product_version').on(table.productId, table.version),
	index('idx_commerce_product_versions_product_status').on(table.productId, table.status, table.createdAt),
	index('idx_commerce_product_versions_catalog_artifact').on(table.catalogArtifactVersionId)
]);

export const commerceOffers = pgTable('commerce_offers', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	productVersionId: text('product_version_id'),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	mode: text('mode').notNull(),
	status: text('status').notNull().default('draft'),
	title: text('title').notNull(),
	termsSummary: text('terms_summary'),
	accessScopeJson: text('access_scope_json').notNull().default('{}'),
	supportScopeJson: text('support_scope_json').notNull().default('{}'),
	fulfillmentMode: text('fulfillment_mode').notNull().default('automatic'),
	activePriceId: text('active_price_id'),
	stripeProductId: text('stripe_product_id'),
	stripeProductStatus: text('stripe_product_status').notNull().default('not_synced'),
	stripeProductSyncedAt: text('stripe_product_synced_at'),
	stripeProductSyncError: text('stripe_product_sync_error'),
	stripeProductMetadataJson: text('stripe_product_metadata_json').notNull().default('{}'),
	startsAt: text('starts_at'),
	endsAt: text('ends_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_offers_product_status').on(table.productId, table.status, table.updatedAt),
	index('idx_commerce_offers_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_offers_seller_status').on(table.sellerTeamId, table.status, table.updatedAt),
	index('idx_commerce_offers_active_price').on(table.activePriceId),
	index('idx_commerce_offers_stripe_product').on(table.stripeProductId),
	index('idx_commerce_offers_stripe_status').on(table.stripeProductStatus, table.updatedAt)
]);

export const commercePrices = pgTable('commerce_prices', {
	id: text('id').primaryKey(),
	offerId: text('offer_id').notNull(),
	amount: integer('amount').notNull(),
	currency: text('currency').notNull(),
	billingInterval: text('billing_interval').notNull(),
	status: text('status').notNull().default('draft'),
	stripeProductId: text('stripe_product_id'),
	stripePriceId: text('stripe_price_id'),
	stripeLookupKey: text('stripe_lookup_key'),
	stripeSyncStatus: text('stripe_sync_status').notNull().default('not_synced'),
	stripeSyncedAt: text('stripe_synced_at'),
	stripeSyncError: text('stripe_sync_error'),
	stripeMetadataJson: text('stripe_metadata_json').notNull().default('{}'),
	priceVersion: integer('price_version').notNull().default(1),
	taxBehavior: text('tax_behavior').notNull().default('unspecified'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_prices_offer_version').on(table.offerId, table.priceVersion),
	index('idx_commerce_prices_offer_status').on(table.offerId, table.status),
	index('idx_commerce_prices_stripe_price').on(table.stripePriceId),
	index('idx_commerce_prices_stripe_sync_status').on(table.stripeSyncStatus, table.updatedAt)
]);

export const commerceGovernanceEvents = pgTable('commerce_governance_events', {
	id: text('id').primaryKey(),
	actorType: text('actor_type').notNull(),
	actorId: text('actor_id'),
	action: text('action').notNull(),
	objectType: text('object_type').notNull(),
	objectId: text('object_id').notNull(),
	priorState: text('prior_state'),
	nextState: text('next_state'),
	reason: text('reason'),
	evidenceJson: text('evidence_json').notNull().default('{}'),
	relatedOrderId: text('related_order_id'),
	relatedOfferId: text('related_offer_id'),
	relatedProductId: text('related_product_id'),
	relatedTeamId: text('related_team_id'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_commerce_governance_events_object').on(table.objectType, table.objectId, table.createdAt),
	index('idx_commerce_governance_events_product').on(table.relatedProductId, table.createdAt),
	index('idx_commerce_governance_events_offer').on(table.relatedOfferId, table.createdAt),
	index('idx_commerce_governance_events_team').on(table.relatedTeamId, table.createdAt)
]);

export const commerceCarts = pgTable('commerce_carts', {
	id: text('id').primaryKey(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	status: text('status').notNull().default('active'),
	currency: text('currency'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_carts_buyer_team_status').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_carts_buyer_user_status').on(table.buyerUserId, table.status, table.updatedAt)
]);

export const commerceCartItems = pgTable('commerce_cart_items', {
	id: text('id').primaryKey(),
	cartId: text('cart_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	productId: text('product_id').notNull(),
	productVersionId: text('product_version_id'),
	offerId: text('offer_id').notNull(),
	priceId: text('price_id'),
	quantity: integer('quantity').notNull().default(1),
	unitAmount: integer('unit_amount').notNull().default(0),
	currency: text('currency').notNull(),
	mode: text('mode').notNull(),
	status: text('status').notNull().default('active'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_cart_items_cart_status').on(table.cartId, table.status),
	index('idx_commerce_cart_items_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_cart_items_offer').on(table.offerId),
	index('idx_commerce_cart_items_price').on(table.priceId)
]);

export const commerceCheckouts = pgTable('commerce_checkouts', {
	id: text('id').primaryKey(),
	cartId: text('cart_id').notNull(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	status: text('status').notNull().default('draft'),
	checkoutMode: text('checkout_mode').notNull().default('stripe_elements_grouped_vendor'),
	groupCount: integer('group_count').notNull().default(0),
	completedGroupCount: integer('completed_group_count').notNull().default(0),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_checkouts_cart').on(table.cartId),
	index('idx_commerce_checkouts_buyer_team_status').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_checkouts_buyer_user_status').on(table.buyerUserId, table.status, table.updatedAt)
]);

export const commerceOrders = pgTable('commerce_orders', {
	id: text('id').primaryKey(),
	checkoutId: text('checkout_id'),
	cartId: text('cart_id'),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	vendorId: text('vendor_id'),
	sellerTeamId: text('seller_team_id'),
	status: text('status').notNull().default('draft'),
	currency: text('currency').notNull(),
	subtotalAmount: integer('subtotal_amount').notNull().default(0),
	totalAmount: integer('total_amount').notNull().default(0),
	refundedAmount: integer('refunded_amount').notNull().default(0),
	refundStatus: text('refund_status').notNull().default('none'),
	stripeCheckoutSessionId: text('stripe_checkout_session_id'),
	stripePaymentIntentId: text('stripe_payment_intent_id'),
	stripeSubscriptionId: text('stripe_subscription_id'),
	stripeCustomerId: text('stripe_customer_id'),
	stripeConnectedAccountId: text('stripe_connected_account_id'),
	ownershipSnapshotJson: text('ownership_snapshot_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_orders_checkout').on(table.checkoutId),
	index('idx_commerce_orders_buyer_team_status').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_orders_buyer_user_status').on(table.buyerUserId, table.status, table.updatedAt),
	index('idx_commerce_orders_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_orders_stripe_payment_intent').on(table.stripePaymentIntentId),
	index('idx_commerce_orders_stripe_subscription').on(table.stripeSubscriptionId)
]);

export const commerceOrderItems = pgTable('commerce_order_items', {
	id: text('id').primaryKey(),
	orderId: text('order_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	productId: text('product_id').notNull(),
	productVersionId: text('product_version_id'),
	offerId: text('offer_id').notNull(),
	priceId: text('price_id'),
	mode: text('mode').notNull(),
	quantity: integer('quantity').notNull().default(1),
	unitAmount: integer('unit_amount').notNull().default(0),
	totalAmount: integer('total_amount').notNull().default(0),
	refundedAmount: integer('refunded_amount').notNull().default(0),
	refundStatus: text('refund_status').notNull().default('none'),
	currency: text('currency').notNull(),
	status: text('status').notNull().default('pending'),
	entitlementId: text('entitlement_id'),
	ownershipSnapshotJson: text('ownership_snapshot_json').notNull().default('{}'),
	accessScopeJson: text('access_scope_json').notNull().default('{}'),
	supportScopeJson: text('support_scope_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_order_items_order').on(table.orderId),
	index('idx_commerce_order_items_product_status').on(table.productId, table.status),
	index('idx_commerce_order_items_offer_status').on(table.offerId, table.status),
	index('idx_commerce_order_items_entitlement').on(table.entitlementId)
]);

export const commercePaymentGroups = pgTable('commerce_payment_groups', {
	id: text('id').primaryKey(),
	checkoutId: text('checkout_id').notNull(),
	orderId: text('order_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	connectedAccountId: text('connected_account_id'),
	groupKind: text('group_kind').notNull(),
	billingInterval: text('billing_interval'),
	status: text('status').notNull().default('pending'),
	currency: text('currency').notNull(),
	subtotalAmount: integer('subtotal_amount').notNull().default(0),
	totalAmount: integer('total_amount').notNull().default(0),
	stripePaymentIntentId: text('stripe_payment_intent_id'),
	stripeSubscriptionId: text('stripe_subscription_id'),
	stripeCustomerId: text('stripe_customer_id'),
	clientSecretLast4: text('client_secret_last4'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_payment_groups_checkout').on(table.checkoutId),
	index('idx_commerce_payment_groups_order').on(table.orderId),
	index('idx_commerce_payment_groups_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_payment_groups_payment_intent').on(table.stripePaymentIntentId),
	index('idx_commerce_payment_groups_subscription').on(table.stripeSubscriptionId)
]);

export const commerceSubscriptions = pgTable('commerce_subscriptions', {
	id: text('id').primaryKey(),
	orderId: text('order_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	offerId: text('offer_id').notNull(),
	priceId: text('price_id').notNull(),
	status: text('status').notNull(),
	renewalState: text('renewal_state').notNull().default('active'),
	stripeSubscriptionId: text('stripe_subscription_id').notNull(),
	stripeCustomerId: text('stripe_customer_id'),
	stripeConnectedAccountId: text('stripe_connected_account_id').notNull(),
	currentPeriodStart: text('current_period_start'),
	currentPeriodEnd: text('current_period_end'),
	cancelAtPeriodEnd: integer('cancel_at_period_end').notNull().default(0),
	canceledAt: text('canceled_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_subscriptions_stripe').on(table.stripeSubscriptionId, table.stripeConnectedAccountId),
	index('idx_commerce_subscriptions_buyer_team_status').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_subscriptions_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_subscriptions_offer_status').on(table.offerId, table.status)
]);

export const commerceEntitlements = pgTable('commerce_entitlements', {
	id: text('id').primaryKey(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	sellerTeamId: text('seller_team_id').notNull(),
	productId: text('product_id').notNull(),
	productVersionId: text('product_version_id'),
	offerId: text('offer_id').notNull(),
	orderId: text('order_id'),
	orderItemId: text('order_item_id'),
	subscriptionId: text('subscription_id'),
	status: text('status').notNull().default('pending'),
	accessScopeJson: text('access_scope_json').notNull().default('{}'),
	startsAt: text('starts_at'),
	endsAt: text('ends_at'),
	renewalState: text('renewal_state').notNull().default('none'),
	fulfillmentArtifactRefsJson: text('fulfillment_artifact_refs_json').notNull().default('[]'),
	projectId: text('project_id'),
	catalogItemId: text('catalog_item_id'),
	ownershipSnapshotJson: text('ownership_snapshot_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_entitlements_buyer_team_status').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_entitlements_buyer_user_status').on(table.buyerUserId, table.status, table.updatedAt),
	index('idx_commerce_entitlements_product_status').on(table.productId, table.status),
	index('idx_commerce_entitlements_offer_status').on(table.offerId, table.status),
	index('idx_commerce_entitlements_order').on(table.orderId),
	index('idx_commerce_entitlements_subscription').on(table.subscriptionId),
	index('idx_commerce_entitlements_catalog_item').on(table.catalogItemId)
]);

export const commerceBuyerStripeCustomers = pgTable('commerce_buyer_stripe_customers', {
	id: text('id').primaryKey(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	vendorId: text('vendor_id').notNull(),
	connectedAccountId: text('connected_account_id').notNull(),
	environment: text('environment').notNull().default('test'),
	stripeCustomerId: text('stripe_customer_id').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_buyer_stripe_customers_team').on(table.vendorId, table.environment, table.buyerTeamId),
	uniqueIndex('idx_commerce_buyer_stripe_customers_user').on(table.vendorId, table.environment, table.buyerUserId),
	uniqueIndex('idx_commerce_buyer_stripe_customers_stripe').on(table.connectedAccountId, table.stripeCustomerId)
]);

export const commerceRefunds = pgTable('commerce_refunds', {
	id: text('id').primaryKey(),
	orderId: text('order_id').notNull(),
	orderItemId: text('order_item_id'),
	paymentGroupId: text('payment_group_id'),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	amount: integer('amount').notNull(),
	currency: text('currency').notNull(),
	status: text('status').notNull().default('processing'),
	reason: text('reason'),
	stripeRefundId: text('stripe_refund_id'),
	stripePaymentIntentId: text('stripe_payment_intent_id'),
	stripeConnectedAccountId: text('stripe_connected_account_id'),
	idempotencyKey: text('idempotency_key').notNull(),
	requestedByType: text('requested_by_type').notNull(),
	requestedById: text('requested_by_id').notNull(),
	failureReason: text('failure_reason'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_refunds_stripe').on(table.stripeRefundId, table.stripeConnectedAccountId),
	uniqueIndex('idx_commerce_refunds_idempotency').on(table.idempotencyKey),
	index('idx_commerce_refunds_order').on(table.orderId, table.createdAt),
	index('idx_commerce_refunds_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_refunds_seller_status').on(table.sellerTeamId, table.status, table.updatedAt)
]);

export const commerceFulfillmentEvents = pgTable('commerce_fulfillment_events', {
	id: text('id').primaryKey(),
	orderId: text('order_id').notNull(),
	orderItemId: text('order_item_id'),
	entitlementId: text('entitlement_id'),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	productId: text('product_id').notNull(),
	productVersionId: text('product_version_id'),
	catalogItemId: text('catalog_item_id'),
	catalogArtifactVersionId: text('catalog_artifact_version_id'),
	eventType: text('event_type').notNull(),
	status: text('status').notNull().default('pending'),
	artifactRefsJson: text('artifact_refs_json').notNull().default('[]'),
	deliveryRefsJson: text('delivery_refs_json').notNull().default('[]'),
	message: text('message'),
	actorType: text('actor_type').notNull(),
	actorId: text('actor_id').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_commerce_fulfillment_events_order').on(table.orderId, table.createdAt),
	index('idx_commerce_fulfillment_events_entitlement').on(table.entitlementId, table.createdAt),
	index('idx_commerce_fulfillment_events_vendor_status').on(table.vendorId, table.status, table.createdAt),
	index('idx_commerce_fulfillment_events_product').on(table.productId, table.createdAt)
]);

export const commerceServiceRequests = pgTable('commerce_service_requests', {
	id: text('id').primaryKey(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	productId: text('product_id').notNull(),
	offerId: text('offer_id').notNull(),
	status: text('status').notNull().default('requested'),
	requestedScope: text('requested_scope').notNull(),
	approvedScope: text('approved_scope'),
	accessNeedsJson: text('access_needs_json').notNull().default('{}'),
	buyerVisibleSummary: text('buyer_visible_summary'),
	vendorPrivateNotes: text('vendor_private_notes'),
	activeQuoteId: text('active_quote_id'),
	approvedQuoteId: text('approved_quote_id'),
	contractId: text('contract_id'),
	relatedProjectId: text('related_project_id'),
	relatedWorkdayId: text('related_workday_id'),
	orderId: text('order_id'),
	entitlementId: text('entitlement_id'),
	ownershipSnapshotJson: text('ownership_snapshot_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_service_requests_buyer_team').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_service_requests_buyer_user').on(table.buyerUserId, table.status, table.updatedAt),
	index('idx_commerce_service_requests_vendor').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_service_requests_seller').on(table.sellerTeamId, table.status, table.updatedAt),
	index('idx_commerce_service_requests_offer').on(table.offerId, table.status),
	index('idx_commerce_service_requests_project').on(table.relatedProjectId, table.status),
	index('idx_commerce_service_requests_workday').on(table.relatedWorkdayId, table.status)
]);

export const commerceServiceQuotes = pgTable('commerce_service_quotes', {
	id: text('id').primaryKey(),
	requestId: text('request_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	quoteVersion: integer('quote_version').notNull().default(1),
	status: text('status').notNull().default('draft'),
	title: text('title').notNull(),
	scopeSummary: text('scope_summary').notNull(),
	deliverablesJson: text('deliverables_json').notNull().default('[]'),
	assumptionsJson: text('assumptions_json').notNull().default('[]'),
	accessRequirementsJson: text('access_requirements_json').notNull().default('{}'),
	governanceRequirementsJson: text('governance_requirements_json').notNull().default('{}'),
	amount: integer('amount').notNull(),
	currency: text('currency').notNull(),
	expiresAt: text('expires_at'),
	buyerApprovedAt: text('buyer_approved_at'),
	vendorApprovedAt: text('vendor_approved_at'),
	acceptedAt: text('accepted_at'),
	rejectedAt: text('rejected_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_service_quotes_request_version').on(table.requestId, table.quoteVersion),
	index('idx_commerce_service_quotes_request').on(table.requestId, table.status, table.updatedAt),
	index('idx_commerce_service_quotes_vendor').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_service_quotes_seller').on(table.sellerTeamId, table.status, table.updatedAt)
]);

export const commerceServiceContracts = pgTable('commerce_service_contracts', {
	id: text('id').primaryKey(),
	requestId: text('request_id').notNull(),
	quoteId: text('quote_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	productId: text('product_id').notNull(),
	offerId: text('offer_id').notNull(),
	status: text('status').notNull().default('pending_checkout'),
	amount: integer('amount').notNull(),
	currency: text('currency').notNull(),
	orderId: text('order_id'),
	orderItemId: text('order_item_id'),
	paymentGroupId: text('payment_group_id'),
	entitlementId: text('entitlement_id'),
	relatedProjectId: text('related_project_id'),
	relatedWorkdayId: text('related_workday_id'),
	ownershipSnapshotJson: text('ownership_snapshot_json').notNull().default('{}'),
	accessApprovalSnapshotJson: text('access_approval_snapshot_json').notNull().default('{}'),
	fulfillmentSummary: text('fulfillment_summary'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_service_contracts_request_quote').on(table.requestId, table.quoteId),
	index('idx_commerce_service_contracts_vendor').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_service_contracts_seller').on(table.sellerTeamId, table.status, table.updatedAt),
	index('idx_commerce_service_contracts_buyer_team').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_service_contracts_buyer_user').on(table.buyerUserId, table.status, table.updatedAt),
	index('idx_commerce_service_contracts_order').on(table.orderId),
	index('idx_commerce_service_contracts_entitlement').on(table.entitlementId),
	index('idx_commerce_service_contracts_project').on(table.relatedProjectId),
	index('idx_commerce_service_contracts_workday').on(table.relatedWorkdayId)
]);

export const commerceServiceEvents = pgTable('commerce_service_events', {
	id: text('id').primaryKey(),
	requestId: text('request_id').notNull(),
	quoteId: text('quote_id'),
	contractId: text('contract_id'),
	eventType: text('event_type').notNull(),
	actorType: text('actor_type').notNull(),
	actorId: text('actor_id'),
	priorState: text('prior_state'),
	nextState: text('next_state'),
	message: text('message'),
	evidenceJson: text('evidence_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_commerce_service_events_request').on(table.requestId, table.createdAt),
	index('idx_commerce_service_events_quote').on(table.quoteId, table.createdAt),
	index('idx_commerce_service_events_contract').on(table.contractId, table.createdAt),
	index('idx_commerce_service_events_type').on(table.eventType, table.createdAt)
]);

export const commerceCapacityListings = pgTable('commerce_capacity_listings', {
	id: text('id').primaryKey(),
	productId: text('product_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	capacityProviderId: text('capacity_provider_id'),
	executionProviderId: text('execution_provider_id'),
	status: text('status').notNull().default('draft'),
	accessLevel: text('access_level').notNull().default('public_summary'),
	runtimeIsolationLevel: text('runtime_isolation_level').notNull().default('none'),
	humanInvolvementLevel: text('human_involvement_level').notNull().default('none'),
	aiInvolvementLevel: text('ai_involvement_level').notNull().default('none'),
	dataAccessLevel: text('data_access_level').notNull().default('none'),
	secretAccessLevel: text('secret_access_level').notNull().default('none'),
	supportedServiceTypesJson: text('supported_service_types_json').notNull().default('[]'),
	supportedRegionsJson: text('supported_regions_json').notNull().default('[]'),
	runtimeRequirementsJson: text('runtime_requirements_json').notNull().default('{}'),
	dataHandlingSummary: text('data_handling_summary'),
	buyerVisibleRiskSummary: text('buyer_visible_risk_summary'),
	governanceRequirementsJson: text('governance_requirements_json').notNull().default('{}'),
	supportPolicy: text('support_policy'),
	availabilitySummary: text('availability_summary'),
	ownershipSnapshotJson: text('ownership_snapshot_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_capacity_listings_product').on(table.productId),
	index('idx_commerce_capacity_listings_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_capacity_listings_seller_status').on(table.sellerTeamId, table.status, table.updatedAt),
	index('idx_commerce_capacity_listings_provider_status').on(table.capacityProviderId, table.status),
	index('idx_commerce_capacity_listings_execution_provider_status').on(table.executionProviderId, table.status),
	index('idx_commerce_capacity_listings_access_status').on(table.accessLevel, table.status, table.updatedAt)
]);

export const commerceCapacityListingInquiries = pgTable('commerce_capacity_listing_inquiries', {
	id: text('id').primaryKey(),
	listingId: text('listing_id').notNull(),
	productId: text('product_id').notNull(),
	vendorId: text('vendor_id').notNull(),
	sellerTeamId: text('seller_team_id').notNull(),
	buyerTeamId: text('buyer_team_id'),
	buyerUserId: text('buyer_user_id'),
	status: text('status').notNull().default('requested'),
	requestedServiceType: text('requested_service_type'),
	requestedScope: text('requested_scope').notNull(),
	dataAccessRequestedJson: text('data_access_requested_json').notNull().default('{}'),
	secretAccessRequestedJson: text('secret_access_requested_json').notNull().default('{}'),
	relatedProjectId: text('related_project_id'),
	relatedWorkdayId: text('related_workday_id'),
	governanceEvidenceJson: text('governance_evidence_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_commerce_capacity_inquiries_listing_status').on(table.listingId, table.status, table.updatedAt),
	index('idx_commerce_capacity_inquiries_buyer_team').on(table.buyerTeamId, table.status, table.updatedAt),
	index('idx_commerce_capacity_inquiries_buyer_user').on(table.buyerUserId, table.status, table.updatedAt),
	index('idx_commerce_capacity_inquiries_vendor_status').on(table.vendorId, table.status, table.updatedAt),
	index('idx_commerce_capacity_inquiries_seller_status').on(table.sellerTeamId, table.status, table.updatedAt),
	index('idx_commerce_capacity_inquiries_project').on(table.relatedProjectId, table.status),
	index('idx_commerce_capacity_inquiries_workday').on(table.relatedWorkdayId, table.status)
]);

export const commerceWebhookEvents = pgTable('commerce_webhook_events', {
	id: text('id').primaryKey(),
	provider: text('provider').notNull().default('stripe'),
	environment: text('environment').notNull().default('test'),
	eventId: text('event_id').notNull(),
	eventType: text('event_type').notNull(),
	connectedAccountId: text('connected_account_id'),
	status: text('status').notNull().default('received'),
	objectType: text('object_type'),
	objectId: text('object_id'),
	relatedOrderId: text('related_order_id'),
	relatedSubscriptionId: text('related_subscription_id'),
	payloadHash: text('payload_hash').notNull(),
	processingError: text('processing_error'),
	receivedAt: text('received_at').notNull(),
	processedAt: text('processed_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_commerce_webhook_events_provider_event').on(table.provider, table.environment, table.eventId),
	index('idx_commerce_webhook_events_status_received').on(table.status, table.receivedAt),
	index('idx_commerce_webhook_events_connected_type').on(table.connectedAccountId, table.eventType, table.receivedAt),
	index('idx_commerce_webhook_events_order').on(table.relatedOrderId),
	index('idx_commerce_webhook_events_subscription').on(table.relatedSubscriptionId)
]);

export const projectHosting = pgTable('project_hosting', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull().unique(),
	hostingKind: text('hosting_kind').notNull(),
	registration: text('registration').notNull().default('none'),
	marketBaseUrl: text('market_base_url'),
	sourceRepoOwner: text('source_repo_owner'),
	sourceRepoName: text('source_repo_name'),
	sourceRepoUrl: text('source_repo_url'),
	sourceRepoWorkflowPath: text('source_repo_workflow_path'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const projectEnvironments = pgTable('project_environments', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	environment: text('environment').notNull(),
	deploymentProfile: text('deployment_profile').notNull(),
	baseUrl: text('base_url'),
	cloudflareAccountId: text('cloudflare_account_id'),
	pagesProjectName: text('pages_project_name'),
	workerName: text('worker_name'),
	r2BucketName: text('r2_bucket_name'),
	d1DatabaseName: text('d1_database_name'),
	queueName: text('queue_name'),
	railwayProjectName: text('railway_project_name'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_project_environments_project_environment').on(table.projectId, table.environment)
]);

export const projectInfrastructureResources = pgTable('project_infrastructure_resources', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	environment: text('environment').notNull(),
	provider: text('provider').notNull(),
	resourceKind: text('resource_kind').notNull(),
	logicalName: text('logical_name').notNull(),
	locator: text('locator'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_project_infrastructure_resource_unique').on(table.projectId, table.environment, table.provider, table.resourceKind, table.logicalName)
]);

export const projectDeployments = pgTable('project_deployments', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	environment: text('environment').notNull(),
	deploymentKind: text('deployment_kind').notNull(),
	action: text('action').notNull().default('deploy_web'),
	status: text('status').notNull(),
	platformOperationId: text('platform_operation_id'),
	retryOfDeploymentId: text('retry_of_deployment_id'),
	resumedFromDeploymentId: text('resumed_from_deployment_id'),
	idempotencyKey: text('idempotency_key'),
	requestedByUserId: text('requested_by_user_id'),
	sourceRef: text('source_ref'),
	releaseTag: text('release_tag'),
	commitSha: text('commit_sha'),
	triggeredByType: text('triggered_by_type'),
	triggeredById: text('triggered_by_id'),
	repositoryJson: text('repository_json').notNull().default('{}'),
	externalWorkflowJson: text('external_workflow_json').notNull().default('{}'),
	targetJson: text('target_json').notNull().default('{}'),
	monitorJson: text('monitor_json').notNull().default('{}'),
	summary: text('summary'),
	errorJson: text('error_json').notNull().default('{}'),
	metadataJson: text('metadata_json'),
	startedAt: text('started_at'),
	finishedAt: text('finished_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	completedAt: text('completed_at'),
}, (table) => [
	index('idx_project_deployments_project_created').on(table.projectId, table.createdAt),
	index('idx_project_deployments_project_environment').on(table.projectId, table.environment, table.createdAt),
	index('idx_project_deployments_project_status').on(table.projectId, table.status, table.updatedAt),
	index('idx_project_deployments_operation').on(table.platformOperationId),
	index('idx_project_deployments_team_created').on(table.teamId, table.createdAt),
	uniqueIndex('idx_project_deployments_idempotency').on(table.projectId, table.idempotencyKey)
]);

export const projectDeploymentEvents = pgTable('project_deployment_events', {
	id: text('id').primaryKey(),
	deploymentId: text('deployment_id').notNull(),
	projectId: text('project_id').notNull(),
	teamId: text('team_id').notNull(),
	operationId: text('operation_id'),
	kind: text('kind').notNull(),
	message: text('message').notNull(),
	status: text('status'),
	severity: text('severity').notNull().default('info'),
	sequence: integer('sequence').notNull(),
	payloadJson: text('payload_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_project_deployment_events_deployment_sequence').on(table.deploymentId, table.sequence),
	index('idx_project_deployment_events_project_created').on(table.projectId, table.createdAt),
	index('idx_project_deployment_events_operation').on(table.operationId)
]);

export const projectSummarySnapshots = pgTable('project_summary_snapshots', {
	projectId: text('project_id').primaryKey(),
	teamId: text('team_id').notNull(),
	summaryJson: text('summary_json').notNull(),
	generatedAt: text('generated_at').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_project_summary_snapshots_team_generated').on(table.teamId, table.generatedAt)
]);

export const teamInboxItems = pgTable('team_inbox_items', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	kind: text('kind').notNull(),
	state: text('state').notNull(),
	title: text('title').notNull(),
	summary: text('summary'),
	href: text('href'),
	itemKey: text('item_key'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_team_inbox_items_team_created').on(table.teamId, table.createdAt)
]);

export const betterAuthUser = pgTable('better_auth_user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('emailVerified').notNull().default(0),
	image: text('image'),
	createdAt: bigint('createdAt', { mode: 'number' }).notNull(),
	updatedAt: bigint('updatedAt', { mode: 'number' }).notNull(),
	username: text('username'),
	firstName: text('firstName'),
	lastName: text('lastName'),
}, (table) => [
	uniqueIndex('idx_better_auth_user_username').on(table.username)
]);

export const betterAuthSession = pgTable('better_auth_session', {
	id: text('id').primaryKey(),
	expiresAt: bigint('expiresAt', { mode: 'number' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: bigint('createdAt', { mode: 'number' }).notNull(),
	updatedAt: bigint('updatedAt', { mode: 'number' }).notNull(),
	ipAddress: text('ipAddress'),
	userAgent: text('userAgent'),
	userId: text('userId').notNull(),
}, (table) => [
	index('idx_better_auth_session_token').on(table.token),
	index('idx_better_auth_session_userId').on(table.userId)
]);

export const betterAuthAccount = pgTable('better_auth_account', {
	id: text('id').primaryKey(),
	accountId: text('accountId').notNull(),
	providerId: text('providerId').notNull(),
	userId: text('userId').notNull(),
	accessToken: text('accessToken'),
	refreshToken: text('refreshToken'),
	idToken: text('idToken'),
	accessTokenExpiresAt: bigint('accessTokenExpiresAt', { mode: 'number' }),
	refreshTokenExpiresAt: bigint('refreshTokenExpiresAt', { mode: 'number' }),
	scope: text('scope'),
	password: text('password'),
	createdAt: bigint('createdAt', { mode: 'number' }).notNull(),
	updatedAt: bigint('updatedAt', { mode: 'number' }).notNull(),
}, (table) => [
	index('idx_better_auth_account_userId').on(table.userId),
	uniqueIndex('idx_better_auth_account_provider_account').on(table.providerId, table.accountId)
]);

export const betterAuthVerification = pgTable('better_auth_verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: bigint('expiresAt', { mode: 'number' }).notNull(),
	createdAt: bigint('createdAt', { mode: 'number' }).notNull(),
	updatedAt: bigint('updatedAt', { mode: 'number' }).notNull(),
}, (table) => [
	index('idx_better_auth_verification_identifier').on(table.identifier)
]);

export const teamWebHosts = pgTable('team_web_hosts', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	provider: text('provider').notNull(),
	ownership: text('ownership').notNull(),
	name: text('name').notNull(),
	accountLabel: text('account_label'),
	allowedEnvironmentsJson: text('allowed_environments_json').notNull().default('[]'),
	status: text('status').notNull().default('active'),
	encryptedPayloadJson: text('encrypted_payload_json'),
	metadataJson: text('metadata_json'),
	createdById: text('created_by_id'),
	updatedById: text('updated_by_id'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_team_web_hosts_team_provider').on(table.teamId, table.provider, table.status),
	uniqueIndex('idx_team_web_hosts_team_provider_name').on(table.teamId, table.provider, table.name)
]);

export const teamInvites = pgTable('team_invites', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	email: text('email').notNull(),
	roleKey: text('role_key').notNull(),
	tokenPrefix: text('token_prefix').notNull(),
	tokenHash: text('token_hash').notNull(),
	status: text('status').notNull().default('pending'),
	invitedByUserId: text('invited_by_user_id'),
	acceptedByUserId: text('accepted_by_user_id'),
	acceptedAt: text('accepted_at'),
	expiresAt: text('expires_at').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_team_invites_team_status').on(table.teamId, table.status, table.createdAt),
	index('idx_team_invites_token_prefix').on(table.tokenPrefix)
]);

export const capacityProviders = pgTable('capacity_providers', {
	id: text('id').primaryKey(),
	fingerprint: text('fingerprint').notNull(),
	publicJwkJson: text('public_jwk_json').notNull(),
	displayName: text('display_name').notNull(),
	identityVersion: integer('identity_version').notNull().default(1),
	status: text('status').notNull().default('active'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	rotatedAt: text('rotated_at'),
	revokedAt: text('revoked_at'),
}, (table) => [
	uniqueIndex('idx_capacity_providers_fingerprint').on(table.fingerprint),
	index('idx_capacity_providers_status').on(table.status, table.updatedAt),
	check('chk_capacity_providers_identity_version', sql`${table.identityVersion} >= 1`),
	check('chk_capacity_providers_status', sql`${table.status} IN ('active', 'rotating', 'revoked')`)
]);

export const capacityProviderIdentityRotations = pgTable('capacity_provider_identity_rotations', {
	id: text('id').primaryKey(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	fromIdentityVersion: integer('from_identity_version').notNull(),
	toIdentityVersion: integer('to_identity_version').notNull(),
	oldFingerprint: text('old_fingerprint').notNull(),
	newFingerprint: text('new_fingerprint').notNull(),
	idempotencyKey: text('idempotency_key').notNull(),
	requestDigest: text('request_digest').notNull(),
	createdAt: text('created_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_provider_identity_rotations_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('cascade'),
	uniqueIndex('idx_capacity_provider_identity_rotations_idempotency').on(table.capacityProviderId, table.idempotencyKey),
	uniqueIndex('idx_capacity_provider_identity_rotations_version').on(table.capacityProviderId, table.toIdentityVersion),
	check('chk_capacity_provider_identity_rotations_versions', sql`${table.fromIdentityVersion} >= 1 AND ${table.toIdentityVersion} = ${table.fromIdentityVersion} + 1`)
]);

export const capacityExecutionProviders = pgTable('capacity_execution_providers', {
	id: text('id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	displayName: text('display_name').notNull(),
	adapter: text('adapter').notNull(),
	status: text('status').notNull().default('active'),
	capabilitiesJson: text('capabilities_json').notNull().default('[]'),
	nativeUnit: text('native_unit').notNull(),
	quotaVisibility: text('quota_visibility').notNull().default('opaque'),
	maxConcurrentRunners: integer('max_concurrent_runners').notNull(),
	nativeLimitsJson: text('native_limits_json').notNull().default('[]'),
	latestObservationJson: text('latest_observation_json'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	primaryKey({ columns: [table.capacityProviderId, table.id] }),
	foreignKey({ name: 'fk_capacity_execution_providers_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('cascade'),
	uniqueIndex('idx_capacity_execution_providers_provider_adapter').on(table.capacityProviderId, table.adapter, table.id),
	index('idx_capacity_execution_providers_provider_status').on(table.capacityProviderId, table.status, table.updatedAt),
	check('chk_capacity_execution_providers_status', sql`${table.status} IN ('active', 'degraded', 'unavailable', 'revoked')`),
	check('chk_capacity_execution_providers_concurrency', sql`${table.maxConcurrentRunners} >= 1`)
]);

export const capacityProviderLanes = pgTable('capacity_provider_lanes', {
	id: text('id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	executionProviderId: text('execution_provider_id').notNull(),
	displayName: text('display_name').notNull(),
	status: text('status').notNull().default('active'),
	capabilitiesJson: text('capabilities_json').notNull().default('[]'),
	maxConcurrentRunners: integer('max_concurrent_runners').notNull(),
	nativeLimitsJson: text('native_limits_json').notNull().default('[]'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	primaryKey({ columns: [table.capacityProviderId, table.id] }),
	foreignKey({ name: 'fk_capacity_provider_lanes_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_provider_lanes_execution_provider', columns: [table.capacityProviderId, table.executionProviderId], foreignColumns: [capacityExecutionProviders.capacityProviderId, capacityExecutionProviders.id] }).onDelete('cascade'),
	uniqueIndex('idx_capacity_provider_lanes_provider_execution_name').on(table.capacityProviderId, table.executionProviderId, table.displayName),
	index('idx_capacity_provider_lanes_provider_status').on(table.capacityProviderId, table.status, table.updatedAt),
	check('chk_capacity_provider_lanes_status', sql`${table.status} IN ('active', 'paused', 'degraded', 'revoked')`),
	check('chk_capacity_provider_lanes_concurrency', sql`${table.maxConcurrentRunners} >= 1`)
]);

export const teamCapacityRegistrationKeys = pgTable('team_capacity_registration_keys', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	generation: integer('generation').notNull(),
	keyPrefix: text('key_prefix').notNull(),
	keyHash: text('key_hash').notNull(),
	encryptedRevealValue: text('encrypted_reveal_value').notNull(),
	rotationIdempotencyKey: text('rotation_idempotency_key'),
	statusIdempotencyKey: text('status_idempotency_key'),
	statusRequestDigest: text('status_request_digest'),
	status: text('status').notNull().default('active'),
	createdById: text('created_by_id'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	rotatedAt: text('rotated_at'),
	lastRevealedAt: text('last_revealed_at'),
}, (table) => [
	foreignKey({ name: 'fk_team_capacity_registration_keys_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	uniqueIndex('idx_team_capacity_registration_keys_generation').on(table.teamId, table.generation),
	uniqueIndex('idx_team_capacity_registration_keys_prefix').on(table.keyPrefix),
	uniqueIndex('idx_team_capacity_registration_keys_rotation').on(table.teamId, table.rotationIdempotencyKey),
	index('idx_team_capacity_registration_keys_current').on(table.teamId, table.status, table.generation),
	check('chk_team_capacity_registration_keys_generation', sql`${table.generation} >= 1`),
	check('chk_team_capacity_registration_keys_status', sql`${table.status} IN ('active', 'disabled')`)
]);

export const capacityProviderRegistrationRequests = pgTable('capacity_provider_registration_requests', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	providerFingerprint: text('provider_fingerprint').notNull(),
	registrationKeyGeneration: integer('registration_key_generation').notNull(),
	status: text('status').notNull().default('pending'),
	capabilitySummaryJson: text('capability_summary_json').notNull().default('[]'),
	supplyOfferJson: text('supply_offer_json').notNull().default('{}'),
	proofJti: text('proof_jti').notNull(),
	idempotencyKey: text('idempotency_key').notNull(),
	requestDigest: text('request_digest').notNull(),
	expiresAt: text('expires_at').notNull(),
	reviewedAt: text('reviewed_at'),
	reviewedById: text('reviewed_by_id'),
	rejectionReason: text('rejection_reason'),
	membershipId: text('membership_id'),
	transitionAction: text('transition_action'),
	transitionIdempotencyKey: text('transition_idempotency_key'),
	transitionRequestDigest: text('transition_request_digest'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_provider_registration_requests_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_provider_registration_requests_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('restrict'),
	uniqueIndex('idx_capacity_provider_registration_request_pending').on(table.teamId, table.capacityProviderId, table.registrationKeyGeneration),
	uniqueIndex('idx_capacity_provider_registration_request_proof').on(table.providerFingerprint, table.proofJti),
	uniqueIndex('idx_capacity_provider_registration_request_idempotency').on(table.teamId, table.idempotencyKey),
	index('idx_capacity_provider_registration_requests_team').on(table.teamId, table.status, table.createdAt),
	index('idx_capacity_provider_registration_requests_provider').on(table.capacityProviderId, table.status, table.createdAt),
	check('chk_capacity_provider_registration_requests_generation', sql`${table.registrationKeyGeneration} >= 1`),
	check('chk_capacity_provider_registration_requests_status', sql`${table.status} IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')`)
]);

export const capacityProviderTeamMemberships = pgTable('capacity_provider_team_memberships', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	status: text('status').notNull().default('approved'),
	teamAlias: text('team_alias'),
	approvedAt: text('approved_at').notNull(),
	approvedById: text('approved_by_id').notNull(),
	suspendedAt: text('suspended_at'),
	revokedAt: text('revoked_at'),
	revokedById: text('revoked_by_id'),
	statusIdempotencyKey: text('status_idempotency_key'),
	statusRequestDigest: text('status_request_digest'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_provider_team_memberships_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_provider_team_memberships_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('restrict'),
	uniqueIndex('idx_capacity_provider_team_memberships_unique').on(table.teamId, table.capacityProviderId),
	index('idx_capacity_provider_team_memberships_team').on(table.teamId, table.status, table.updatedAt),
	index('idx_capacity_provider_team_memberships_provider').on(table.capacityProviderId, table.status, table.updatedAt),
	check('chk_capacity_provider_team_memberships_status', sql`${table.status} IN ('approved', 'suspended', 'revoked')`)
]);

export const capacityProviderCredentialIssuanceAuthorizations = pgTable('capacity_provider_credential_issuance_authorizations', {
	id: text('id').primaryKey(),
	membershipId: text('membership_id').notNull(),
	teamId: text('team_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	generation: integer('generation').notNull(),
	idempotencyKey: text('idempotency_key').notNull(),
	status: text('status').notNull().default('pending'),
	issuedCredentialId: text('issued_credential_id'),
	createdByType: text('created_by_type').notNull(),
	createdById: text('created_by_id').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_provider_credential_authorizations_membership', columns: [table.membershipId], foreignColumns: [capacityProviderTeamMemberships.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_provider_credential_authorizations_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_provider_credential_authorizations_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('restrict'),
	uniqueIndex('idx_capacity_provider_credential_authorizations_generation').on(table.membershipId, table.generation),
	uniqueIndex('idx_capacity_provider_credential_authorizations_idempotency').on(table.membershipId, table.idempotencyKey),
	index('idx_capacity_provider_credential_authorizations_pending').on(table.membershipId, table.status, table.createdAt),
	check('chk_capacity_provider_credential_authorizations_generation', sql`${table.generation} >= 1`),
	check('chk_capacity_provider_credential_authorizations_status', sql`${table.status} IN ('pending', 'issued', 'cancelled')`)
]);

export const capacityProviderTeamCredentials = pgTable('capacity_provider_team_credentials', {
	id: text('id').primaryKey(),
	membershipId: text('membership_id').notNull(),
	teamId: text('team_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	keyPrefix: text('key_prefix').notNull(),
	keyHash: text('key_hash').notNull(),
	issuanceAuthorizationId: text('issuance_authorization_id').notNull(),
	issuanceGeneration: integer('issuance_generation').notNull(),
	issueIdempotencyKey: text('issue_idempotency_key').notNull(),
	scopesJson: text('scopes_json').notNull().default('[]'),
	status: text('status').notNull().default('active'),
	lastUsedAt: text('last_used_at'),
	rotatedFromCredentialId: text('rotated_from_credential_id'),
	expiresAt: text('expires_at'),
	revealedAt: text('revealed_at'),
	revokedAt: text('revoked_at'),
	revokeIdempotencyKey: text('revoke_idempotency_key'),
	revokeRequestDigest: text('revoke_request_digest'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_provider_team_credentials_membership', columns: [table.membershipId], foreignColumns: [capacityProviderTeamMemberships.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_provider_team_credentials_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_provider_team_credentials_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_provider_team_credentials_authorization', columns: [table.issuanceAuthorizationId], foreignColumns: [capacityProviderCredentialIssuanceAuthorizations.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_provider_team_credentials_rotated_from', columns: [table.rotatedFromCredentialId], foreignColumns: [table.id] }).onDelete('set null'),
	uniqueIndex('idx_capacity_provider_team_credentials_prefix').on(table.keyPrefix),
	uniqueIndex('idx_capacity_provider_team_credentials_issue').on(table.membershipId, table.issueIdempotencyKey),
	uniqueIndex('idx_capacity_provider_team_credentials_generation').on(table.membershipId, table.issuanceGeneration),
	index('idx_capacity_provider_team_credentials_membership').on(table.membershipId, table.status, table.createdAt),
	check('chk_capacity_provider_team_credentials_status', sql`${table.status} IN ('active', 'rotating', 'revoked')`)
]);

export const capacityProviderAccessTokens = pgTable('capacity_provider_access_tokens', {
	id: text('id').primaryKey(),
	membershipId: text('membership_id').notNull(),
	credentialId: text('credential_id').notNull(),
	idempotencyKey: text('idempotency_key').notNull(),
	tokenPrefix: text('token_prefix').notNull(),
	tokenHash: text('token_hash').notNull(),
	scopesJson: text('scopes_json').notNull().default('[]'),
	status: text('status').notNull().default('active'),
	issuedAt: text('issued_at').notNull(),
	expiresAt: text('expires_at').notNull(),
	lastUsedAt: text('last_used_at'),
	expiredAt: text('expired_at'),
	revokedAt: text('revoked_at'),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_provider_access_tokens_membership', columns: [table.membershipId], foreignColumns: [capacityProviderTeamMemberships.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_provider_access_tokens_credential', columns: [table.credentialId], foreignColumns: [capacityProviderTeamCredentials.id] }).onDelete('cascade'),
	uniqueIndex('idx_capacity_provider_access_tokens_prefix').on(table.tokenPrefix),
	uniqueIndex('idx_capacity_provider_access_tokens_issue').on(table.membershipId, table.idempotencyKey),
	index('idx_capacity_provider_access_tokens_membership').on(table.membershipId, table.status, table.expiresAt),
	check('chk_capacity_provider_access_tokens_status', sql`${table.status} IN ('active', 'revoked', 'expired')`)
]);

export const capacityProviderProofNonces = pgTable('capacity_provider_proof_nonces', {
	providerFingerprint: text('provider_fingerprint').notNull(),
	jti: text('jti').notNull(),
	expiresAt: text('expires_at').notNull(),
	createdAt: text('created_at').notNull(),
}, (table) => [
	primaryKey({ columns: [table.providerFingerprint, table.jti] }),
	index('idx_capacity_provider_proof_nonces_expiry').on(table.expiresAt)
]);

export const capacityProviderRegistrationRateLimits = pgTable('capacity_provider_registration_rate_limits', {
	dimension: text('dimension').notNull(),
	bucketKey: text('bucket_key').notNull(),
	count: integer('count').notNull().default(0),
	windowStartedAt: text('window_started_at').notNull(),
	expiresAt: text('expires_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	primaryKey({ columns: [table.dimension, table.bucketKey] }),
	index('idx_capacity_provider_registration_rate_limits_expiry').on(table.expiresAt),
	check('chk_capacity_provider_registration_rate_limits_count', sql`${table.count} >= 0`)
]);

export const capacityAuditEvents = pgTable('capacity_audit_events', {
	id: text('id').primaryKey(),
	teamId: text('team_id'),
	capacityProviderId: text('capacity_provider_id'),
	membershipId: text('membership_id'),
	actorType: text('actor_type').notNull(),
	actorId: text('actor_id'),
	action: text('action').notNull(),
	resourceType: text('resource_type').notNull(),
	resourceId: text('resource_id'),
	requestId: text('request_id'),
	idempotencyKey: text('idempotency_key'),
	beforeFingerprint: text('before_fingerprint'),
	afterFingerprint: text('after_fingerprint'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_capacity_audit_events_team_created').on(table.teamId, table.createdAt),
	index('idx_capacity_audit_events_provider_created').on(table.capacityProviderId, table.createdAt),
	index('idx_capacity_audit_events_membership_created').on(table.membershipId, table.createdAt),
	index('idx_capacity_audit_events_resource').on(table.resourceType, table.resourceId, table.createdAt),
	uniqueIndex('idx_capacity_audit_events_idempotency').on(table.teamId, table.action, table.resourceType, table.resourceId, table.idempotencyKey)
]);

export const capacityOperationReceipts = pgTable('capacity_operation_receipts', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	operation: text('operation').notNull(),
	idempotencyKey: text('idempotency_key').notNull(),
	requestDigest: text('request_digest').notNull(),
	resourceType: text('resource_type').notNull(),
	resourceId: text('resource_id'),
	responseJson: text('response_json').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_operation_receipts_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	uniqueIndex('idx_capacity_operation_receipts_idempotency').on(table.teamId, table.operation, table.idempotencyKey),
	index('idx_capacity_operation_receipts_resource').on(table.teamId, table.resourceType, table.resourceId, table.createdAt),
]);

export const capacityGrants = pgTable('capacity_grants', {
	id: text('id').primaryKey(),
	membershipId: text('membership_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	environment: text('environment').notNull(),
	status: text('status').notNull().default('planned'),
	executionProviderIdsJson: text('execution_provider_ids_json').notNull().default('[]'),
	laneIdsJson: text('lane_ids_json').notNull().default('[]'),
	capabilitiesJson: text('capabilities_json').notNull().default('[]'),
	allowedModesJson: text('allowed_modes_json').notNull().default('[]'),
	dailyCreditLimit: real('daily_credit_limit'),
	monthlyCreditLimit: real('monthly_credit_limit'),
	maxConcurrentAssignments: integer('max_concurrent_assignments'),
	unmetered: integer('unmetered').notNull().default(0),
	expiresAt: text('expires_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_grants_membership', columns: [table.membershipId], foreignColumns: [capacityProviderTeamMemberships.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_grants_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_grants_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_grants_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('cascade'),
	index('idx_capacity_grants_team_project').on(table.teamId, table.projectId, table.status),
	index('idx_capacity_grants_membership').on(table.membershipId, table.status, table.expiresAt),
	index('idx_capacity_grants_provider').on(table.capacityProviderId, table.status),
	check('chk_capacity_grants_status', sql`${table.status} IN ('planned', 'active', 'paused', 'revoked', 'expired')`),
	check('chk_capacity_grants_unmetered', sql`${table.unmetered} IN (0, 1)`),
	check('chk_capacity_grants_daily_limit', sql`${table.dailyCreditLimit} IS NULL OR ${table.dailyCreditLimit} >= 0`),
	check('chk_capacity_grants_monthly_limit', sql`${table.monthlyCreditLimit} IS NULL OR ${table.monthlyCreditLimit} >= 0`),
	check('chk_capacity_grants_concurrency', sql`${table.maxConcurrentAssignments} IS NULL OR ${table.maxConcurrentAssignments} >= 0`)
]);

export const capacityReservations = pgTable('capacity_reservations', {
	id: text('id').primaryKey(),
	idempotencyKey: text('idempotency_key').notNull(),
	admissionToken: text('admission_token').notNull(),
	membershipId: text('membership_id').notNull(),
	grantId: text('grant_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	executionProviderId: text('execution_provider_id'),
	laneId: text('lane_id'),
	allocationSetId: text('allocation_set_id').notNull(),
	allocationVersion: integer('allocation_version').notNull(),
	allocationSliceIdsJson: text('allocation_slice_ids_json').notNull().default('[]'),
	policySnapshotJson: text('policy_snapshot_json').notNull().default('{}'),
	projectAgentClassId: text('project_agent_class_id').notNull(),
	assignmentId: text('assignment_id'),
	mode: text('mode').notNull(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	workDayId: text('work_day_id'),
	taskId: text('task_id'),
	state: text('state').notNull().default('reserved'),
	usageReportToken: text('usage_report_token'),
	settlementToken: text('settlement_token'),
	reservedCredits: real('reserved_credits').notNull(),
	consumedCredits: real('consumed_credits').notNull().default(0),
	nativeUnit: text('native_unit'),
	reservedNativeAmount: real('reserved_native_amount'),
	consumedNativeAmount: real('consumed_native_amount'),
	reservedProviderUnits: real('reserved_provider_units'),
	consumedProviderUnits: real('consumed_provider_units'),
	reservedUsd: real('reserved_usd'),
	consumedUsd: real('consumed_usd'),
	expiresAt: text('expires_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_reservations_membership', columns: [table.membershipId], foreignColumns: [capacityProviderTeamMemberships.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_reservations_grant', columns: [table.grantId], foreignColumns: [capacityGrants.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_reservations_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_reservations_execution_provider', columns: [table.capacityProviderId, table.executionProviderId], foreignColumns: [capacityExecutionProviders.capacityProviderId, capacityExecutionProviders.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_reservations_lane', columns: [table.capacityProviderId, table.laneId], foreignColumns: [capacityProviderLanes.capacityProviderId, capacityProviderLanes.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_reservations_allocation', columns: [table.allocationSetId], foreignColumns: [capacityAllocationSets.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_reservations_agent_class', columns: [table.projectAgentClassId], foreignColumns: [projectAgentClasses.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_reservations_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_reservations_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('restrict'),
	uniqueIndex('idx_capacity_reservations_idempotency').on(table.teamId, table.idempotencyKey),
	index('idx_capacity_reservations_project_workday_state').on(table.projectId, table.workDayId, table.state, table.createdAt),
	index('idx_capacity_reservations_membership_state').on(table.membershipId, table.state, table.createdAt),
	index('idx_capacity_reservations_provider_state').on(table.capacityProviderId, table.state, table.createdAt),
	index('idx_capacity_reservations_execution_provider_state').on(table.executionProviderId, table.state, table.createdAt),
	index('idx_capacity_reservations_lane_state').on(table.laneId, table.state, table.createdAt),
	check('chk_capacity_reservations_allocation_version', sql`${table.allocationVersion} >= 1`),
	check('chk_capacity_reservations_mode', sql`${table.mode} IN ('planning', 'acting')`),
	check('chk_capacity_reservations_state', sql`${table.state} IN ('reserved', 'consuming', 'consumed', 'released', 'expired', 'failed', 'overran_pending_approval', 'continuation_required')`),
	check('chk_capacity_reservations_reserved_credits', sql`${table.reservedCredits} > 0`),
	check('chk_capacity_reservations_consumed_credits', sql`${table.consumedCredits} >= 0`)
]);

export const capacityAdmissionCounters = pgTable('capacity_admission_counters', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	scope: text('scope').notNull(),
	scopeId: text('scope_id').notNull(),
	periodKey: text('period_key').notNull(),
	hardLimit: real('hard_limit').notNull(),
	committedAmount: real('committed_amount').notNull().default(0),
	stateVersion: integer('state_version').notNull().default(1),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_capacity_admission_counters_scope').on(table.teamId, table.scope, table.scopeId, table.periodKey),
	index('idx_capacity_admission_counters_team').on(table.teamId, table.updatedAt),
	check('chk_capacity_admission_counter_hard_limit', sql`${table.hardLimit} >= 0`),
	check('chk_capacity_admission_counter_committed_amount', sql`${table.committedAmount} >= 0 AND ${table.committedAmount} <= ${table.hardLimit}`)
]);

export const capacityReservationCounterClaims = pgTable('capacity_reservation_counter_claims', {
	reservationId: text('reservation_id').notNull(),
	counterId: text('counter_id').notNull(),
	admissionToken: text('admission_token').notNull(),
	reservedAmount: real('reserved_amount').notNull(),
	releasedAmount: real('released_amount').notNull().default(0),
	releasePolicy: text('release_policy').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_capacity_reservation_counter_claim').on(table.reservationId, table.counterId),
	index('idx_capacity_reservation_counter_counter').on(table.counterId, table.createdAt),
	check('chk_capacity_reservation_claim_reserved', sql`${table.reservedAmount} >= 0`),
	check('chk_capacity_reservation_claim_released', sql`${table.releasedAmount} >= 0 AND ${table.releasedAmount} <= ${table.reservedAmount}`)
]);

export const capacityLedgerEntries = pgTable('capacity_ledger_entries', {
	id: text('id').primaryKey(),
	settlementKey: text('settlement_key').notNull(),
	membershipId: text('membership_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	reservationId: text('reservation_id'),
	assignmentId: text('assignment_id'),
	modeRunId: text('mode_run_id'),
	mode: text('mode'),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	workDayId: text('work_day_id'),
	taskId: text('task_id'),
	phase: text('phase').notNull(),
	credits: real('credits').notNull(),
	providerUnits: real('provider_units'),
	usd: real('usd'),
	source: text('source').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_ledger_membership', columns: [table.membershipId], foreignColumns: [capacityProviderTeamMemberships.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_ledger_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_ledger_reservation', columns: [table.reservationId], foreignColumns: [capacityReservations.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_ledger_assignment', columns: [table.assignmentId], foreignColumns: [capacityProviderAssignments.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_ledger_mode_run', columns: [table.modeRunId], foreignColumns: [agentModeRuns.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_ledger_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_ledger_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('restrict'),
	uniqueIndex('idx_capacity_ledger_settlement_key').on(table.settlementKey),
	uniqueIndex('idx_capacity_ledger_reservation_phase').on(table.reservationId, table.phase),
	index('idx_capacity_ledger_assignment').on(table.assignmentId, table.createdAt),
	index('idx_capacity_ledger_project_workday_created').on(table.projectId, table.workDayId, table.createdAt),
	check('chk_capacity_ledger_credits', sql`${table.credits} >= 0`)
]);

export const capacityUsageActuals = pgTable('capacity_usage_actuals', {
	id: text('id').primaryKey(),
	idempotencyKey: text('idempotency_key').notNull(),
	taskId: text('task_id'),
	workDayId: text('work_day_id'),
	projectId: text('project_id').notNull(),
	taskSignature: text('task_signature').notNull(),
	assignmentId: text('assignment_id'),
	assignmentAttempt: integer('assignment_attempt').notNull(),
	usageDimension: text('usage_dimension').notNull(),
	accountingMode: text('accounting_mode').notNull(),
	modeRunId: text('mode_run_id'),
	mode: text('mode'),
	capacityProviderId: text('capacity_provider_id'),
	executionProviderId: text('execution_provider_id'),
	laneId: text('lane_id'),
	businessModel: text('business_model').notNull(),
	modelName: text('model_name'),
	inputTokens: integer('input_tokens'),
	outputTokens: integer('output_tokens'),
	cachedInputTokens: integer('cached_input_tokens'),
	quotaMinutes: real('quota_minutes'),
	wallMinutes: real('wall_minutes'),
	filesOpened: integer('files_opened'),
	filesChanged: integer('files_changed'),
	diffLinesAdded: integer('diff_lines_added'),
	diffLinesRemoved: integer('diff_lines_removed'),
	testRuns: integer('test_runs'),
	retryCount: integer('retry_count'),
	actualCredits: real('actual_credits').notNull(),
	actualUsd: real('actual_usd'),
	creditFormulaVersion: text('credit_formula_version').notNull().default('treeseed.actual-credits.v1'),
	actualCreditSource: text('actual_credit_source').notNull().default('central_calculator'),
	nativeUsageJson: text('native_usage_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	executionProfileId: text('execution_profile_id').notNull().default('standard-code-model'),
}, (table) => [
	foreignKey({ name: 'fk_capacity_usage_actuals_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_usage_actuals_assignment', columns: [table.assignmentId], foreignColumns: [capacityProviderAssignments.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_usage_actuals_mode_run', columns: [table.modeRunId], foreignColumns: [agentModeRuns.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_usage_actuals_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_usage_actuals_execution_provider', columns: [table.capacityProviderId, table.executionProviderId], foreignColumns: [capacityExecutionProviders.capacityProviderId, capacityExecutionProviders.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_usage_actuals_lane', columns: [table.capacityProviderId, table.laneId], foreignColumns: [capacityProviderLanes.capacityProviderId, capacityProviderLanes.id] }).onDelete('restrict'),
	uniqueIndex('idx_capacity_usage_actuals_idempotency').on(table.idempotencyKey),
	uniqueIndex('idx_capacity_usage_actuals_attempt_dimension').on(table.assignmentId, table.assignmentAttempt, table.usageDimension),
	index('idx_capacity_usage_actuals_project_signature').on(table.projectId, table.taskSignature, table.createdAt),
	index('idx_capacity_usage_actuals_project_signature_profile').on(table.projectId, table.taskSignature, table.executionProfileId, table.createdAt),
	index('idx_capacity_usage_actuals_execution_provider').on(table.executionProviderId, table.createdAt),
	index('idx_capacity_usage_actuals_lane').on(table.laneId, table.createdAt),
	check('chk_capacity_usage_actuals_credits', sql`${table.actualCredits} >= 0`),
	check('chk_capacity_usage_actuals_assignment_attempt', sql`${table.assignmentAttempt} >= 0`),
	check('chk_capacity_usage_actuals_accounting_mode', sql`${table.accountingMode} IN ('informational', 'incremental', 'aggregate')`)
]);

export const capacityAllocationSets = pgTable('capacity_allocation_sets', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	version: integer('version').notNull(),
	status: text('status').notNull().default('draft'),
	effectiveFrom: text('effective_from').notNull(),
	effectiveUntil: text('effective_until'),
	reservePolicyJson: text('reserve_policy_json').notNull().default('{}'),
	slicesJson: text('slices_json').notNull().default('[]'),
	borrowingRulesJson: text('borrowing_rules_json').notNull().default('[]'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdById: text('created_by_id'),
	activatedAt: text('activated_at'),
	supersededById: text('superseded_by_id'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_allocation_sets_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_allocation_sets_superseded_by', columns: [table.supersededById], foreignColumns: [table.id] }).onDelete('restrict'),
	uniqueIndex('idx_capacity_allocation_sets_team_version').on(table.teamId, table.version),
	index('idx_capacity_allocation_sets_team_status').on(table.teamId, table.status, table.effectiveFrom),
	index('idx_capacity_allocation_sets_team_created').on(table.teamId, table.createdAt),
	check('chk_capacity_allocation_sets_version', sql`${table.version} >= 1`),
	check('chk_capacity_allocation_sets_status', sql`${table.status} IN ('draft', 'validated', 'active', 'superseded', 'archived')`),
	check('chk_capacity_allocation_sets_effective_interval', sql`${table.effectiveUntil} IS NULL OR ${table.effectiveUntil} > ${table.effectiveFrom}`)
]);

export const projectAgentClasses = pgTable('project_agent_classes', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	slug: text('slug').notNull(),
	name: text('name').notNull(),
	status: text('status').notNull().default('active'),
	allowedModesJson: text('allowed_modes_json').notNull().default('[]'),
	requiredCapabilitiesJson: text('required_capabilities_json').notNull().default('[]'),
	kernelProfileJson: text('kernel_profile_json').notNull().default('{}'),
	kernelPolicyJson: text('kernel_policy_json').notNull().default('{}'),
	handlerRefsJson: text('handler_refs_json').notNull().default('{}'),
	outputContractsJson: text('output_contracts_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_project_agent_classes_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_project_agent_classes_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('cascade'),
	uniqueIndex('idx_project_agent_classes_project_slug').on(table.projectId, table.slug),
	index('idx_project_agent_classes_team_project').on(table.teamId, table.projectId, table.status),
	check('chk_project_agent_classes_status', sql`${table.status} IN ('active', 'paused', 'archived')`)
]);

export const providerAvailabilitySessions = pgTable('capacity_provider_availability_sessions', {
	id: text('id').primaryKey(),
	membershipId: text('membership_id').notNull(),
	teamId: text('team_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	environment: text('environment'),
	status: text('status').notNull().default('open'),
	sequence: integer('sequence').notNull().default(1),
	openedAt: text('opened_at').notNull(),
	refreshedAt: text('refreshed_at').notNull(),
	expiresAt: text('expires_at').notNull(),
	availableFrom: text('available_from').notNull(),
	availableUntil: text('available_until'),
	executionProvidersJson: text('execution_providers_json').notNull().default('[]'),
	capabilitiesJson: text('capabilities_json').notNull().default('[]'),
	nativeLimitsJson: text('native_limits_json').notNull().default('{}'),
	runnerPressureJson: text('runner_pressure_json').notNull().default('{}'),
	constraintsJson: text('constraints_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	closedAt: text('closed_at'),
}, (table) => [
	foreignKey({ name: 'fk_capacity_provider_availability_sessions_membership', columns: [table.membershipId], foreignColumns: [capacityProviderTeamMemberships.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_provider_availability_sessions_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
	foreignKey({ name: 'fk_capacity_provider_availability_sessions_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('restrict'),
	index('idx_capacity_provider_availability_sessions_membership_status').on(table.membershipId, table.status, table.expiresAt),
	index('idx_capacity_provider_availability_sessions_provider_status').on(table.capacityProviderId, table.status, table.refreshedAt),
	index('idx_capacity_provider_availability_sessions_team_status').on(table.teamId, table.status, table.refreshedAt),
	check('chk_capacity_provider_availability_sessions_sequence', sql`${table.sequence} >= 1`),
	check('chk_capacity_provider_availability_sessions_status', sql`${table.status} IN ('open', 'draining', 'closed', 'expired')`)
]);

export const capacityProviderAssignments = pgTable('capacity_provider_assignments', {
	id: text('id').primaryKey(),
	membershipId: text('membership_id').notNull(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	providerSessionId: text('provider_session_id'),
	executionProviderId: text('execution_provider_id'),
	laneId: text('lane_id'),
	allocationSetId: text('allocation_set_id'),
	projectAgentClassId: text('project_agent_class_id').notNull(),
	reservationId: text('reservation_id'),
	workDayId: text('work_day_id'),
	taskId: text('task_id'),
	mode: text('mode').notNull(),
	status: text('status').notNull().default('pending'),
	leaseState: text('lease_state').notNull().default('unleased'),
	leaseExpiresAt: text('lease_expires_at'),
	leaseToken: text('lease_token'),
	stateVersion: integer('state_version').notNull().default(1),
	leaseRenewedAt: text('lease_renewed_at'),
	runnerId: text('runner_id'),
	agentId: text('agent_id'),
	handlerId: text('handler_id'),
	capacityEnvelopeJson: text('capacity_envelope_json').notNull().default('{}'),
	decisionInputJson: text('decision_input_json').notNull().default('{}'),
	workspaceContextJson: text('workspace_context_json').notNull().default('{}'),
	allowedOutputsJson: text('allowed_outputs_json').notNull().default('{}'),
	explanationJson: text('explanation_json').notNull().default('{}'),
	attemptCount: integer('attempt_count').notNull().default(0),
	assignedAt: text('assigned_at'),
	claimedAt: text('claimed_at'),
	completedAt: text('completed_at'),
	returnedAt: text('returned_at'),
	failedAt: text('failed_at'),
	lifecycleReason: text('lifecycle_reason'),
	lifecycleCode: text('lifecycle_code'),
	lifecycleOutputJson: text('lifecycle_output_json').notNull().default('{}'),
	synthesizedFrom: text('synthesized_from'),
	synthesisKey: text('synthesis_key'),
	decisionId: text('decision_id'),
	proposalId: text('proposal_id'),
	fallbackOutputId: text('fallback_output_id'),
	treedxProxyHandleJson: text('treedx_proxy_handle_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	foreignKey({ name: 'fk_capacity_provider_assignments_membership', columns: [table.membershipId], foreignColumns: [capacityProviderTeamMemberships.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_provider_assignments_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_provider_assignments_project', columns: [table.projectId], foreignColumns: [projects.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_provider_assignments_provider', columns: [table.capacityProviderId], foreignColumns: [capacityProviders.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_provider_assignments_session', columns: [table.providerSessionId], foreignColumns: [providerAvailabilitySessions.id] }).onDelete('set null'),
	foreignKey({ name: 'fk_capacity_provider_assignments_execution_provider', columns: [table.capacityProviderId, table.executionProviderId], foreignColumns: [capacityExecutionProviders.capacityProviderId, capacityExecutionProviders.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_provider_assignments_lane', columns: [table.capacityProviderId, table.laneId], foreignColumns: [capacityProviderLanes.capacityProviderId, capacityProviderLanes.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_provider_assignments_allocation', columns: [table.allocationSetId], foreignColumns: [capacityAllocationSets.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_provider_assignments_agent_class', columns: [table.projectAgentClassId], foreignColumns: [projectAgentClasses.id] }).onDelete('restrict'),
	foreignKey({ name: 'fk_capacity_provider_assignments_reservation', columns: [table.reservationId], foreignColumns: [capacityReservations.id] }).onDelete('restrict'),
	index('idx_capacity_provider_assignments_membership_status').on(table.membershipId, table.status, table.leaseExpiresAt),
	index('idx_capacity_provider_assignments_provider_status').on(table.capacityProviderId, table.status, table.leaseExpiresAt),
	index('idx_capacity_provider_assignments_lane_status').on(table.laneId, table.status, table.leaseExpiresAt),
	index('idx_capacity_provider_assignments_project_mode').on(table.projectId, table.mode, table.status),
	index('idx_capacity_provider_assignments_lease').on(table.capacityProviderId, table.leaseState, table.leaseExpiresAt),
	index('idx_capacity_provider_assignments_runner').on(table.runnerId, table.leaseState),
	uniqueIndex('idx_capacity_provider_assignments_synthesis_key').on(table.teamId, table.synthesisKey),
	index('idx_capacity_provider_assignments_decision').on(table.decisionId, table.status),
	index('idx_capacity_provider_assignments_team_created').on(table.teamId, table.createdAt),
	check('chk_capacity_provider_assignments_state_version', sql`${table.stateVersion} >= 1`),
	check('chk_capacity_provider_assignments_mode', sql`${table.mode} IN ('planning', 'acting')`),
	check('chk_capacity_provider_assignments_status', sql`${table.status} IN ('pending', 'leased', 'running', 'completed', 'failed', 'returned', 'expired', 'cancelled')`),
	check('chk_capacity_provider_assignments_lease_state', sql`${table.leaseState} IN ('unleased', 'leased', 'released', 'expired')`)
]);

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
	foreignKey({ name: 'fk_agent_mode_runs_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('restrict'),
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
	foreignKey({ name: 'fk_agent_fallback_outputs_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('restrict'),
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
	foreignKey({ name: 'fk_research_workflows_team', columns: [table.teamId], foreignColumns: [teams.id] }),
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
	foreignKey({ name: 'fk_capacity_workday_runs_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('restrict'),
	index('idx_capacity_workday_runs_team_status').on(table.teamId, table.status, table.updatedAt),
	index('idx_capacity_workday_runs_provider').on(table.capacityProviderId, table.updatedAt),
	check('chk_capacity_workday_runs_status', sql`${table.status} IN ('queued','running','completed','cancelled','failed','degraded')`),
	check('chk_capacity_workday_runs_next_event', sql`${table.nextEventIndex} >= 0`)
]);

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
	foreignKey({ name: 'fk_capacity_workday_events_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('restrict'),
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
	foreignKey({ name: 'fk_capacity_workday_participation_cycles_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('restrict'),
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
	foreignKey({ name: 'fk_workday_capacity_envelopes_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('restrict'),
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
	foreignKey({ name: 'fk_capacity_workday_demands_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('restrict'),
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
	foreignKey({ name: 'fk_capacity_workday_participation_entries_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('restrict'),
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

export const githubRepositoryGrants = pgTable('github_repository_grants', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	repository: text('repository').notNull(),
	installationId: text('installation_id'),
	accountLogin: text('account_login'),
	accountId: text('account_id'),
	status: text('status').notNull().default('active'),
	permissionsJson: text('permissions_json').notNull().default('{}'),
	environmentsJson: text('environments_json').notNull().default('[]'),
	driftCode: text('drift_code'),
	observedAt: text('observed_at'),
	revokedAt: text('revoked_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_github_repository_grants_project').on(table.teamId, table.projectId, table.status),
	uniqueIndex('idx_github_repository_grants_repository').on(table.teamId, table.repository)
]);

export const githubAppInstallationRecords = pgTable('github_app_installation_records', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	installationId: text('installation_id').notNull(),
	accountLogin: text('account_login'),
	accountId: text('account_id'),
	accountType: text('account_type'),
	status: text('status').notNull().default('active'),
	permissionsJson: text('permissions_json').notNull().default('{}'),
	repositorySelection: text('repository_selection'),
	driftCode: text('drift_code'),
	observedAt: text('observed_at'),
	revokedAt: text('revoked_at'),
	suspendedAt: text('suspended_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_github_app_installations_team_status').on(table.teamId, table.status, table.updatedAt),
	uniqueIndex('idx_github_app_installations_team_installation').on(table.teamId, table.installationId)
]);

export const githubAppTokenIssuanceRecords = pgTable('github_app_token_issuance_records', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	assignmentId: text('assignment_id'),
	providerId: text('provider_id'),
	workdayId: text('workday_id'),
	operationId: text('operation_id'),
	repository: text('repository').notNull(),
	installationId: text('installation_id').notNull(),
	status: text('status').notNull().default('issued'),
	tokenPrefix: text('token_prefix'),
	tokenHash: text('token_hash'),
	permissionsJson: text('permissions_json').notNull().default('{}'),
	allowedOperationsJson: text('allowed_operations_json').notNull().default('[]'),
	expiresAt: text('expires_at'),
	issuedAt: text('issued_at'),
	revokedAt: text('revoked_at'),
	failClosedCode: text('fail_closed_code'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_github_app_token_issuance_project').on(table.teamId, table.projectId, table.status, table.updatedAt),
	index('idx_github_app_token_issuance_operation').on(table.operationId, table.status, table.expiresAt),
	index('idx_github_app_token_issuance_assignment').on(table.assignmentId, table.status, table.expiresAt)
]);

export const workflowOperationRecords = pgTable('workflow_operation_records', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	name: text('name').notNull(),
	repository: text('repository').notNull(),
	workflowFile: text('workflow_file').notNull(),
	secretBearing: integer('secret_bearing').notNull().default(0),
	trustedExecutionSetId: text('trusted_execution_set_id').notNull(),
	dispatchJson: text('dispatch_json').notNull().default('{}'),
	inputsJson: text('inputs_json').notNull().default('[]'),
	secretClassesJson: text('secret_classes_json').notNull().default('[]'),
	status: text('status').notNull().default('active'),
	failClosedCode: text('fail_closed_code'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	blockedAt: text('blocked_at'),
}, (table) => [
	index('idx_workflow_operation_records_project').on(table.teamId, table.projectId, table.status),
	uniqueIndex('idx_workflow_operation_records_operation').on(table.teamId, table.id)
]);

export const workflowDispatchRecords = pgTable('workflow_dispatch_records', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	workflowOperationId: text('workflow_operation_id').notNull(),
	platformOperationId: text('platform_operation_id'),
	repository: text('repository').notNull(),
	workflowFile: text('workflow_file').notNull(),
	ref: text('ref'),
	status: text('status').notNull().default('queued'),
	inputsJson: text('inputs_json').notNull().default('{}'),
	resultJson: text('result_json').notNull().default('{}'),
	failClosedCode: text('fail_closed_code'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	dispatchedAt: text('dispatched_at'),
	completedAt: text('completed_at'),
}, (table) => [
	index('idx_workflow_dispatch_records_operation').on(table.workflowOperationId, table.status, table.createdAt),
	index('idx_workflow_dispatch_records_platform').on(table.platformOperationId)
]);

export const treeDxCredentialIssuanceRecords = pgTable('treedx_credential_issuance_records', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	assignmentId: text('assignment_id'),
	repository: text('repository'),
	credentialProvider: text('credential_provider').notNull(),
	status: text('status').notNull().default('issued'),
	tokenPrefix: text('token_prefix'),
	tokenHash: text('token_hash'),
	scopesJson: text('scopes_json').notNull().default('[]'),
	allowedOperationsJson: text('allowed_operations_json').notNull().default('[]'),
	expiresAt: text('expires_at'),
	issuedAt: text('issued_at'),
	revokedAt: text('revoked_at'),
	failClosedCode: text('fail_closed_code'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_treedx_credential_issuance_assignment').on(table.assignmentId, table.status, table.expiresAt),
	index('idx_treedx_credential_issuance_project').on(table.projectId, table.status, table.updatedAt)
]);

export const approvalRequests = pgTable('approval_requests', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	workDayId: text('work_day_id'),
	taskId: text('task_id'),
	kind: text('kind').notNull(),
	state: text('state').notNull().default('pending'),
	severity: text('severity').notNull().default('medium'),
	requestedByType: text('requested_by_type').notNull().default('worker'),
	requestedById: text('requested_by_id'),
	title: text('title').notNull(),
	summary: text('summary').notNull(),
	optionsJson: text('options_json').notNull().default('[]'),
	recommendationJson: text('recommendation_json').notNull().default('{}'),
	policySnapshotJson: text('policy_snapshot_json').notNull().default('{}'),
	expiresAt: text('expires_at'),
	decidedByType: text('decided_by_type'),
	decidedById: text('decided_by_id'),
	decidedAt: text('decided_at'),
	decisionJson: text('decision_json'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_approval_requests_team_state').on(table.teamId, table.state, table.createdAt),
	index('idx_approval_requests_project_workday').on(table.projectId, table.workDayId, table.state, table.createdAt)
]);

export const repositoryHosts = pgTable('repository_hosts', {
	id: text('id').primaryKey(),
	teamId: text('team_id'),
	provider: text('provider').notNull(),
	ownership: text('ownership').notNull(),
	name: text('name').notNull(),
	accountLabel: text('account_label'),
	organizationOrOwner: text('organization_or_owner').notNull(),
	defaultVisibility: text('default_visibility').notNull().default('private'),
	softwareRepositoryNameTemplate: text('software_repository_name_template').notNull().default('{hub}-site'),
	contentRepositoryNameTemplate: text('content_repository_name_template').notNull().default('{hub}-content'),
	branchPolicyJson: text('branch_policy_json').notNull().default('{}'),
	workflowPolicyJson: text('workflow_policy_json').notNull().default('{}'),
	encryptedPayloadJson: text('encrypted_payload_json'),
	allowedProjectKindsJson: text('allowed_project_kinds_json').notNull().default('["knowledge_hub"]'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	status: text('status').notNull().default('active'),
	createdById: text('created_by_id'),
	updatedById: text('updated_by_id'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_repository_hosts_team_provider').on(table.teamId, table.provider, table.status),
	uniqueIndex('idx_repository_hosts_team_provider_name').on(table.teamId, table.provider, table.name),
	uniqueIndex('idx_repository_hosts_platform_provider_name').on(table.provider, table.name)
]);

export const hubRepositories = pgTable('hub_repositories', {
	id: text('id').primaryKey(),
	hubId: text('hub_id').notNull(),
	teamId: text('team_id').notNull(),
	role: text('role').notNull(),
	repositoryHostId: text('repository_host_id'),
	provider: text('provider').notNull(),
	owner: text('owner').notNull(),
	name: text('name').notNull(),
	url: text('url'),
	defaultBranch: text('default_branch'),
	currentBranch: text('current_branch'),
	status: text('status').notNull().default('queued'),
	accessPolicyJson: text('access_policy_json').notNull().default('{}'),
	releasePolicyJson: text('release_policy_json').notNull().default('{}'),
	publishPolicyJson: text('publish_policy_json').notNull().default('{}'),
	submodulePath: text('submodule_path'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_hub_repositories_hub_role').on(table.hubId, table.role)
]);

export const hubContentSources = pgTable('hub_content_sources', {
	id: text('id').primaryKey(),
	hubId: text('hub_id').notNull().unique(),
	teamId: text('team_id').notNull(),
	contentRepositoryId: text('content_repository_id'),
	productionSource: text('production_source').notNull(),
	overlayPolicy: text('overlay_policy').notNull(),
	r2BucketName: text('r2_bucket_name'),
	r2ManifestKey: text('r2_manifest_key'),
	r2PublicBaseUrl: text('r2_public_base_url'),
	latestPublishId: text('latest_publish_id'),
	latestContentVersion: text('latest_content_version'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const treeDxInstances = pgTable('treedx_instances', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	kind: text('kind').notNull(),
	provider: text('provider').notNull(),
	name: text('name').notNull(),
	baseUrl: text('base_url'),
	registryUrl: text('registry_url'),
	publicRead: integer('public_read').notNull().default(0),
	primary: integer('primary').notNull().default(1),
	status: text('status').notNull().default('pending'),
	imageRef: text('image_ref'),
	railwayProjectId: text('railway_project_id'),
	railwayServiceId: text('railway_service_id'),
	railwayEnvironmentId: text('railway_environment_id'),
	volumeMountPath: text('volume_mount_path'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_treedx_instances_team_status').on(table.teamId, table.status),
]);

export const treeDxProjectLibraries = pgTable('treedx_project_libraries', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	instanceId: text('instance_id').notNull(),
	libraryId: text('library_id').notNull(),
	repositoryId: text('repository_id'),
	contentPath: text('content_path').notNull().default('src/content'),
	contentRepositoryUrl: text('content_repository_url'),
	contentRepositoryDefaultBranch: text('content_repository_default_branch'),
	contentRepositoryRef: text('content_repository_ref'),
	r2BucketName: text('r2_bucket_name'),
	r2ManifestKey: text('r2_manifest_key'),
	topologyJson: text('topology_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_treedx_project_libraries_project').on(table.projectId),
	index('idx_treedx_project_libraries_instance').on(table.instanceId),
]);

export const treeDxMirrors = pgTable('treedx_mirrors', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	instanceId: text('instance_id').notNull(),
	name: text('name').notNull(),
	direction: text('direction').notNull().default('bidirectional'),
	targetKind: text('target_kind').notNull(),
	targetUrl: text('target_url'),
	status: text('status').notNull().default('pending'),
	instructions: text('instructions'),
	lastSyncAt: text('last_sync_at'),
	lastSyncStatus: text('last_sync_status'),
	lastSyncMetadataJson: text('last_sync_metadata_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_treedx_mirrors_team_instance').on(table.teamId, table.instanceId),
]);

export const treeDxShares = pgTable('treedx_shares', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	instanceId: text('instance_id'),
	projectId: text('project_id'),
	libraryId: text('library_id'),
	scope: text('scope').notNull(),
	targetTeamId: text('target_team_id'),
	trustGrantJson: text('trust_grant_json').notNull().default('{}'),
	publicRead: integer('public_read').notNull().default(0),
	status: text('status').notNull().default('active'),
	expiresAt: text('expires_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	revokedAt: text('revoked_at'),
}, (table) => [
	index('idx_treedx_shares_team_scope').on(table.teamId, table.scope, table.status),
]);

export const treeDxDeployments = pgTable('treedx_deployments', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	instanceId: text('instance_id'),
	provider: text('provider').notNull(),
	status: text('status').notNull().default('queued'),
	imageRef: text('image_ref'),
	volumeMountPath: text('volume_mount_path'),
	serviceRefsJson: text('service_refs_json').notNull().default('{}'),
	resultJson: text('result_json').notNull().default('{}'),
	errorJson: text('error_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	completedAt: text('completed_at'),
}, (table) => [
	index('idx_treedx_deployments_team_instance').on(table.teamId, table.instanceId, table.createdAt),
]);

export const hubLaunches = pgTable('hub_launches', {
	id: text('id').primaryKey(),
	hubId: text('hub_id').notNull(),
	teamId: text('team_id').notNull(),
	jobId: text('job_id'),
	intentJson: text('intent_json').notNull(),
	planJson: text('plan_json').notNull().default('{}'),
	state: text('state').notNull(),
	currentPhase: text('current_phase'),
	lastSuccessfulPhase: text('last_successful_phase'),
	resultJson: text('result_json'),
	errorJson: text('error_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	completedAt: text('completed_at'),
}, (table) => [
	index('idx_hub_launches_hub_created').on(table.hubId, table.createdAt)
]);

export const hubLaunchEvents = pgTable('hub_launch_events', {
	id: text('id').primaryKey(),
	launchId: text('launch_id').notNull(),
	seq: integer('seq').notNull(),
	phase: text('phase').notNull(),
	status: text('status').notNull(),
	title: text('title'),
	summary: text('summary'),
	startedAt: text('started_at'),
	finishedAt: text('finished_at'),
	errorJson: text('error_json'),
	dataJson: text('data_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	uniqueIndex('idx_hub_launch_events_launch_seq').on(table.launchId, table.seq)
]);

export const hubWorkspaceLinks = pgTable('hub_workspace_links', {
	id: text('id').primaryKey(),
	hubId: text('hub_id').notNull(),
	teamId: text('team_id').notNull(),
	parentRepositoryHostId: text('parent_repository_host_id'),
	parentOwner: text('parent_owner'),
	parentName: text('parent_name'),
	parentUrl: text('parent_url'),
	parentBranch: text('parent_branch'),
	hubMountPath: text('hub_mount_path'),
	softwareSubmodulePath: text('software_submodule_path'),
	contentSubmodulePath: text('content_submodule_path'),
	updateSubmodulePointersEnabled: integer('update_submodule_pointers_enabled').notNull().default(0),
	accessPolicyJson: text('access_policy_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_hub_workspace_links_hub').on(table.hubId)
]);

export const projectUpdatePlans = pgTable('project_update_plans', {
	id: text('id').primaryKey(),
	hubId: text('hub_id').notNull(),
	teamId: text('team_id').notNull(),
	sourceKind: text('source_kind').notNull(),
	sourceRef: text('source_ref'),
	sourceVersion: text('source_version'),
	planJson: text('plan_json').notNull().default('{}'),
	state: text('state').notNull().default('planned'),
	requiresDecision: integer('requires_decision').notNull().default(0),
	decisionId: text('decision_id'),
	createdBy: text('created_by'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_project_update_plans_hub').on(table.hubId, table.createdAt)
]);

export const providerCredentialSessions = pgTable('provider_credential_sessions', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	jobId: text('job_id'),
	hostKind: text('host_kind').notNull(),
	hostId: text('host_id').notNull(),
	purpose: text('purpose').notNull(),
	encryptedPayloadJson: text('encrypted_payload_json').notNull(),
	status: text('status').notNull().default('active'),
	expiresAt: text('expires_at').notNull(),
	consumedAt: text('consumed_at'),
	createdById: text('created_by_id'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
}, (table) => [
	index('idx_provider_credential_sessions_team_host').on(table.teamId, table.hostKind, table.hostId, table.status),
	index('idx_provider_credential_sessions_job').on(table.jobId, table.status)
]);

export const userPreferences = pgTable('user_preferences', {
	userId: text('user_id').primaryKey(),
	colorScheme: text('color_scheme').notNull().default('fern'),
	themeMode: text('theme_mode').notNull().default('system'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const authProviderStates = pgTable('auth_provider_states', {
	id: text('id').primaryKey(),
	provider: text('provider').notNull(),
	stateHash: text('state_hash').notNull().unique(),
	codeVerifier: text('code_verifier'),
	nonce: text('nonce'),
	callbackUrl: text('callback_url').notNull(),
	returnTo: text('return_to').notNull(),
	linkUserId: text('link_user_id'),
	purpose: text('purpose').notNull().default('sign-in'),
	action: text('action'),
	expiresAt: text('expires_at').notNull(),
	usedAt: text('used_at'),
	createdAt: text('created_at').notNull(),
}, (table) => [index('idx_auth_provider_states_expiry').on(table.expiresAt, table.usedAt)]);

export const authReauthenticationGrants = pgTable('auth_reauthentication_grants', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	sessionId: text('session_id').notNull(),
	action: text('action').notNull(),
	expiresAt: text('expires_at').notNull(),
	consumedAt: text('consumed_at'),
	createdAt: text('created_at').notNull(),
}, (table) => [index('idx_auth_reauthentication_grants_session').on(table.userId, table.sessionId, table.action, table.expiresAt)]);

export const userPersonalThemes = pgTable('user_personal_themes', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	name: text('name').notNull(),
	normalizedName: text('normalized_name').notNull(),
	baseScheme: text('base_scheme').notNull(),
	paletteJson: text('palette_json').notNull(),
	compilerVersion: integer('compiler_version').notNull().default(1),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_user_personal_themes_name').on(table.userId, table.normalizedName),
	index('idx_user_personal_themes_user').on(table.userId, table.updatedAt),
]);

export const userNotificationPreferences = pgTable('user_notification_preferences', {
	userId: text('user_id').primaryKey(),
	emailCadence: text('email_cadence').notNull().default('daily'),
	timeZone: text('time_zone').notNull().default('UTC'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const userNotificationGlobalContentTypes = pgTable('user_notification_global_content_types', {
	userId: text('user_id').notNull(),
	contentType: text('content_type').notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.contentType] })]);

export const userNotificationProjectOverrides = pgTable('user_notification_project_overrides', {
	userId: text('user_id').notNull(),
	projectId: text('project_id').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.projectId] })]);

export const userNotificationProjectContentTypes = pgTable('user_notification_project_content_types', {
	userId: text('user_id').notNull(),
	projectId: text('project_id').notNull(),
	contentType: text('content_type').notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.projectId, table.contentType] })]);

export const notificationEvents = pgTable('notification_events', {
	id: text('id').primaryKey(),
	eventType: text('event_type').notNull(),
	contentType: text('content_type').notNull(),
	projectId: text('project_id').notNull(),
	actorId: text('actor_id'),
	resourceId: text('resource_id').notNull(),
	title: text('title').notNull(),
	summary: text('summary'),
	targetUrl: text('target_url').notNull(),
	createdAt: text('created_at').notNull(),
}, (table) => [index('idx_notification_events_project').on(table.projectId, table.createdAt)]);

export const userNotifications = pgTable('user_notifications', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	eventId: text('event_id').notNull(),
	readAt: text('read_at'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	uniqueIndex('idx_user_notifications_event').on(table.userId, table.eventId),
	index('idx_user_notifications_user').on(table.userId, table.readAt, table.createdAt),
]);

export const notificationEmailDeliveries = pgTable('notification_email_deliveries', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	eventId: text('event_id'),
	digestKey: text('digest_key').notNull().unique(),
	cadence: text('cadence').notNull(),
	status: text('status').notNull().default('pending'),
	dueAt: text('due_at').notNull(),
	attempts: integer('attempts').notNull().default(0),
	sentAt: text('sent_at'),
	lastError: text('last_error'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_notification_email_deliveries_due').on(table.status, table.dueAt)]);

export const creditConversionProfiles = pgTable('credit_conversion_profiles', {
	id: text('id').primaryKey(),
	taskSignature: text('task_signature').notNull(),
	executionProfileId: text('execution_profile_id').notNull().default('standard-code-model'),
	executionProviderKind: text('execution_provider_kind').notNull(),
	nativeUnit: text('native_unit').notNull(),
	sampleCount: integer('sample_count').notNull().default(0),
	completedSampleCount: integer('completed_sample_count').notNull().default(0),
	interruptedSampleCount: integer('interrupted_sample_count').notNull().default(0),
	nativeUnitsPerCreditP50: real('native_units_per_credit_p50'),
	nativeUnitsPerCreditP90: real('native_units_per_credit_p90'),
	creditsPerNativeUnitP50: real('credits_per_native_unit_p50'),
	creditsPerNativeUnitP90: real('credits_per_native_unit_p90'),
	actualCreditsP50: real('actual_credits_p50'),
	actualCreditsP90: real('actual_credits_p90'),
	confidence: text('confidence').notNull().default('low'),
	formulaVersion: text('formula_version').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_credit_conversion_profiles_profile_key').on(table.taskSignature, table.executionProfileId, table.executionProviderKind, table.nativeUnit),
	index('idx_credit_conversion_profiles_kind_unit').on(table.executionProviderKind, table.nativeUnit, table.updatedAt),
	check('chk_credit_conversion_profiles_sample_counts', sql`${table.sampleCount} >= 0 AND ${table.completedSampleCount} >= 0 AND ${table.interruptedSampleCount} >= 0 AND ${table.completedSampleCount} + ${table.interruptedSampleCount} <= ${table.sampleCount}`),
	check('chk_credit_conversion_profiles_native_p50', sql`${table.nativeUnitsPerCreditP50} IS NULL OR ${table.nativeUnitsPerCreditP50} >= 0`),
	check('chk_credit_conversion_profiles_native_p90', sql`${table.nativeUnitsPerCreditP90} IS NULL OR ${table.nativeUnitsPerCreditP90} >= 0`),
	check('chk_credit_conversion_profiles_credit_p50', sql`${table.creditsPerNativeUnitP50} IS NULL OR ${table.creditsPerNativeUnitP50} >= 0`),
	check('chk_credit_conversion_profiles_credit_p90', sql`${table.creditsPerNativeUnitP90} IS NULL OR ${table.creditsPerNativeUnitP90} >= 0`),
	check('chk_credit_conversion_profiles_actual_p50', sql`${table.actualCreditsP50} IS NULL OR ${table.actualCreditsP50} >= 0`),
	check('chk_credit_conversion_profiles_actual_p90', sql`${table.actualCreditsP90} IS NULL OR ${table.actualCreditsP90} >= 0`),
	check('chk_credit_conversion_profiles_confidence', sql`${table.confidence} IN ('low', 'medium', 'high')`)
]);

export const seedRuns = pgTable('seed_runs', {
	id: text('id').primaryKey(),
	seedName: text('seed_name').notNull(),
	seedVersion: integer('seed_version').notNull(),
	environmentsJson: text('environments_json').notNull(),
	mode: text('mode').notNull(),
	state: text('state').notNull(),
	actorType: text('actor_type'),
	actorId: text('actor_id'),
	manifestHash: text('manifest_hash').notNull(),
	planJson: text('plan_json').notNull(),
	resultJson: text('result_json'),
	errorJson: text('error_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	completedAt: text('completed_at'),
}, (table) => [
	index('idx_seed_runs_seed_created').on(table.seedName, table.createdAt),
	index('idx_seed_runs_state_created').on(table.state, table.createdAt)
]);

export const runtimeRecords = pgTable('runtime_records', {
	id: serial('id').primaryKey(),
	recordType: text('record_type').notNull(),
	recordKey: text('record_key').notNull(),
	lookupKey: text('lookup_key'),
	secondaryKey: text('secondary_key'),
	status: text('status').notNull(),
	schemaVersion: integer('schema_version').notNull().default(1),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	payloadJson: text('payload_json').notNull(),
	metaJson: text('meta_json').notNull(),
}, (table) => [
	index('idx_runtime_records_type_lookup_updated').on(table.recordType, table.lookupKey, table.updatedAt),
	index('idx_runtime_records_type_status_updated').on(table.recordType, table.status, table.updatedAt)
]);

export const cursorState = pgTable('cursor_state', {
	agentSlug: text('agent_slug'),
	cursorKey: text('cursor_key'),
	status: text('status').notNull(),
	schemaVersion: integer('schema_version').notNull().default(1),
	updatedAt: text('updated_at').notNull(),
	payloadJson: text('payload_json').notNull(),
	metaJson: text('meta_json').notNull(),
}, (table) => [
	primaryKey({ columns: [table.agentSlug, table.cursorKey] }),
	index('idx_cursor_state_updated').on(table.updatedAt)
]);

export const leaseState = pgTable('lease_state', {
	model: text('model'),
	itemKey: text('item_key'),
	status: text('status').notNull(),
	schemaVersion: integer('schema_version').notNull().default(1),
	claimedBy: text('claimed_by'),
	claimedAt: text('claimed_at'),
	leaseExpiresAt: text('lease_expires_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	payloadJson: text('payload_json').notNull(),
	metaJson: text('meta_json').notNull(),
}, (table) => [
	primaryKey({ columns: [table.model, table.itemKey] }),
	index('idx_lease_state_status_expires').on(table.status, table.leaseExpiresAt),
	index('idx_lease_state_claimed_by').on(table.claimedBy, table.updatedAt)
]);

export const messageQueue = pgTable('message_queue', {
	id: serial('id').primaryKey(),
	messageType: text('message_type').notNull(),
	status: text('status').notNull(),
	schemaVersion: integer('schema_version').notNull().default(1),
	relatedModel: text('related_model'),
	relatedId: text('related_id'),
	priority: integer('priority').notNull().default(0),
	availableAt: text('available_at').notNull(),
	claimedBy: text('claimed_by'),
	claimedAt: text('claimed_at'),
	leaseExpiresAt: text('lease_expires_at'),
	attempts: integer('attempts').notNull().default(0),
	maxAttempts: integer('max_attempts').notNull().default(3),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	payloadJson: text('payload_json').notNull(),
	metaJson: text('meta_json').notNull(),
}, (table) => [
	index('idx_message_queue_claimable').on(table.status, table.availableAt, table.priority),
	index('idx_message_queue_related').on(table.relatedModel, table.relatedId, table.createdAt)
]);

export const platformOperations = pgTable('platform_operations', {
	id: text('id').primaryKey(),
	namespace: text('namespace').notNull(),
	operation: text('operation').notNull(),
	status: text('status').notNull(),
	target: text('target').notNull(),
	idempotencyKey: text('idempotency_key'),
	inputJson: text('input_json').notNull().default('{}'),
	outputJson: text('output_json'),
	errorJson: text('error_json'),
	requestedByType: text('requested_by_type').notNull(),
	requestedById: text('requested_by_id'),
	assignedRunnerId: text('assigned_runner_id'),
	leaseExpiresAt: text('lease_expires_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	startedAt: text('started_at'),
	finishedAt: text('finished_at'),
	cancelledAt: text('cancelled_at'),
}, (table) => [
	uniqueIndex('idx_platform_operations_idempotency').on(table.namespace, table.operation, table.idempotencyKey),
	index('idx_platform_operations_runnable').on(table.status, table.createdAt)
]);

export const platformOperationEvents = pgTable('platform_operation_events', {
	id: text('id').primaryKey(),
	operationId: text('operation_id').notNull(),
	seq: integer('seq').notNull(),
	kind: text('kind').notNull(),
	dataJson: text('data_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	uniqueIndex('idx_platform_operation_events_seq').on(table.operationId, table.seq)
]);

export const marketOperationRunners = pgTable('market_operation_runners', {
	id: text('id').primaryKey(),
	runnerKey: text('runner_key').notNull().unique(),
	name: text('name').notNull(),
	environment: text('environment').notNull(),
	status: text('status').notNull().default('online'),
	version: text('version'),
	capabilitiesJson: text('capabilities_json').notNull().default('[]'),
	activeJobCount: integer('active_job_count').notNull().default(0),
	maxConcurrentJobs: integer('max_concurrent_jobs').notNull().default(1),
	heartbeatAt: text('heartbeat_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const platformRepositoryClaims = pgTable('platform_repository_claims', {
	id: text('id').primaryKey(),
	repositoryKey: text('repository_key').notNull(),
	runnerId: text('runner_id').notNull(),
	workspacePath: text('workspace_path').notNull(),
	branch: text('branch'),
	commitSha: text('commit_sha'),
	claimState: text('claim_state').notNull().default('active'),
	leaseExpiresAt: text('lease_expires_at'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_platform_repository_claims_active').on(table.repositoryKey, table.runnerId),
	index('idx_platform_repository_claims_runner').on(table.runnerId, table.claimState)
]);

export const marketAuthCredentials = pgTable('market_auth_credentials', {
	userId: text('user_id').primaryKey(),
	email: text('email').notNull().unique(),
	username: text('username').unique(),
	passwordHash: text('password_hash').notNull(),
	status: text('status').notNull().default('active'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const marketAuthPasswordResets = pgTable('market_auth_password_resets', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	tokenHash: text('token_hash').notNull().unique(),
	expiresAt: text('expires_at').notNull(),
	usedAt: text('used_at'),
	createdAt: text('created_at').notNull(),
});

export const treeseedMarketSchema = {
	subscribers,
	agentRuns,
	agentMessages,
	contactSubmissions,
	runtimeEnvelopes,
	users,
	userIdentities,
	userEmailAddresses,
	roles,
	permissions,
	rolePermissions,
	userRoleBindings,
	apiTokens,
	serviceCredentials,
	authSessions,
	auditEvents,
	deviceCodes,
	teams,
	teamMemberships,
	teamRoleBindings,
	webSessions,
	commonsParticipants,
	commonsQuestions,
	commonsProposals,
	commonsWeightSnapshots,
	commonsProposalBackings,
	commonsProposalVotes,
	commonsDelegations,
	commonsDecisions,
	commonsGovernanceEvents,
	teamGovernancePolicies,
	projectGovernancePolicies,
	governanceProposals,
	governanceProposalVersions,
	governanceElectorateSnapshots,
	governanceProposalVotes,
	governanceVoteEvents,
	governanceDelegations,
	governanceDecisions,
	governanceEvents,
	projects,
	projectConnections,
	projectCapabilityGrants,
	teamApiKeys,
	entitlements,
	remoteJobs,
	remoteJobEvents,
	knowledgePacks,
	teamStorageLocators,
	catalogItems,
	catalogArtifactVersions,
	catalogItemCollaborators,
	commerceVendors,
	commerceProducts,
	commerceOwnershipRecords,
	commerceStewardshipAssignments,
	commerceContributions,
	commerceGovernancePolicies,
	commerceOwnershipTransfers,
	commerceProductVersions,
	commerceOffers,
	commercePrices,
	commerceGovernanceEvents,
	commerceCarts,
	commerceCartItems,
	commerceCheckouts,
	commerceOrders,
	commerceOrderItems,
	commercePaymentGroups,
	commerceSubscriptions,
	commerceEntitlements,
	commerceBuyerStripeCustomers,
	commerceRefunds,
	commerceFulfillmentEvents,
	commerceServiceRequests,
	commerceServiceQuotes,
	commerceServiceContracts,
	commerceServiceEvents,
	commerceCapacityListings,
	commerceCapacityListingInquiries,
	commerceWebhookEvents,
	projectHosting,
	projectEnvironments,
	projectInfrastructureResources,
	projectDeployments,
	projectDeploymentEvents,
	projectSummarySnapshots,
	teamInboxItems,
	betterAuthUser,
	betterAuthSession,
	betterAuthAccount,
	betterAuthVerification,
	teamWebHosts,
	teamInvites,
	capacityProviders,
	capacityExecutionProviders,
	capacityProviderLanes,
	teamCapacityRegistrationKeys,
	capacityProviderRegistrationRequests,
	capacityProviderTeamMemberships,
	capacityProviderTeamCredentials,
	capacityProviderAccessTokens,
	capacityProviderProofNonces,
	capacityProviderRegistrationRateLimits,
	capacityAuditEvents,
	capacityOperationReceipts,
	capacityGrants,
	capacityReservations,
	capacityAdmissionCounters,
	capacityReservationCounterClaims,
	capacityLedgerEntries,
	capacityUsageActuals,
	approvalRequests,
	repositoryHosts,
	hubRepositories,
	hubContentSources,
	treeDxInstances,
	treeDxProjectLibraries,
	treeDxMirrors,
	treeDxShares,
	treeDxDeployments,
	secretMetadataRecords,
	clientEncryptedEscrowRecords,
	githubRepositoryGrants,
	workflowOperationRecords,
	workflowDispatchRecords,
	treeDxCredentialIssuanceRecords,
	hubLaunches,
	hubLaunchEvents,
	hubWorkspaceLinks,
	projectUpdatePlans,
	providerCredentialSessions,
	userPreferences,
	authProviderStates,
	authReauthenticationGrants,
	userPersonalThemes,
	userNotificationPreferences,
	userNotificationGlobalContentTypes,
	userNotificationProjectOverrides,
	userNotificationProjectContentTypes,
	notificationEvents,
	userNotifications,
	notificationEmailDeliveries,
	creditConversionProfiles,
	seedRuns,
	runtimeRecords,
	cursorState,
	leaseState,
	messageQueue,
	capacityAllocationSets,
	projectAgentClasses,
	providerAvailabilitySessions,
	decisionPlanningStatuses,
	planningInputRequests,
	decisionExecutionInputs,
	structuredAgentEstimates,
	decisionAssignmentGraphs,
	deliverableContracts,
	deliverableManifests,
	capacityWorkdayRuns,
	capacityWorkdayEvents,
	workdayCapacityEnvelopes,
	capacityProviderAssignments,
	agentModeRuns,
	agentFallbackOutputs,
	agentCapacityPlans,
	treeDxProxyHandles,
	platformOperations,
	platformOperationEvents,
	marketOperationRunners,
	platformRepositoryClaims,
	marketAuthCredentials,
	marketAuthPasswordResets,
};

export type TreeseedMarketDrizzleSchema = typeof treeseedMarketSchema;
