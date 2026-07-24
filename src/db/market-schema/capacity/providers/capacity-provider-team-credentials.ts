import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { capacityExecutionProviders, capacityProviderCredentialIssuanceAuthorizations, capacityProviderLanes, capacityProviderTeamMemberships, capacityProviders } from '../../accounts/better-auth-account.ts';
import { teams } from '../../support/subscribers.ts';
import { projects } from '../../governance/policy/governance-electorate-snapshots.ts';
import { capacityAllocationSets, projectAgentClasses } from '../accounting/capacity-ledger-entries.ts';

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
	foreignKey({ name: 'fk_capacity_reservations_team', columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
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
