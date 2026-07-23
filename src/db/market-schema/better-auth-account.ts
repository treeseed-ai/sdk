import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { teams } from './subscribers.ts';

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
