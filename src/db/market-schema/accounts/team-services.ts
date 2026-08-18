import { index,integer,pgTable,text,uniqueIndex } from 'drizzle-orm/pg-core';

const timestamps = {
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
};

export const teamServiceConnections = pgTable('team_service_connections', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	providerId: text('provider_id').notNull(),
	displayName: text('display_name').notNull(),
	status: text('status').notNull().default('draft'),
	nonSecretConfigJson: text('non_secret_config_json').notNull().default('{}'),
	version: integer('version').notNull().default(1),
	createdByUserId: text('created_by_user_id'),
	updatedByUserId: text('updated_by_user_id'),
	lastValidatedAt: text('last_validated_at'),
	...timestamps,
}, (table) => [
	index('idx_team_service_connections_team_status').on(table.teamId, table.status, table.updatedAt),
	uniqueIndex('idx_team_service_connections_team_provider_name').on(table.teamId, table.providerId, table.displayName),
]);

export const teamServiceCapabilityBindings = pgTable('team_service_capability_bindings', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	connectionId: text('connection_id').notNull(),
	capabilityType: text('capability_type').notNull(),
	status: text('status').notNull().default('configured'),
	credentialProfileId: text('credential_profile_id'),
	configurationJson: text('configuration_json').notNull().default('{}'),
	...timestamps,
}, (table) => [
	index('idx_team_service_capabilities_team_type').on(table.teamId, table.capabilityType, table.status),
	uniqueIndex('idx_team_service_capabilities_connection_type').on(table.connectionId, table.capabilityType),
]);

export const teamServiceCredentialProfiles = pgTable('team_service_credential_profiles', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	connectionId: text('connection_id').notNull(),
	definitionId: text('definition_id').notNull(),
	custodyMode: text('custody_mode').notNull(),
	status: text('status').notNull().default('configured'),
	envelopeVersion: text('envelope_version'),
	fingerprint: text('fingerprint'),
	lastRotatedAt: text('last_rotated_at'),
	lastValidatedAt: text('last_validated_at'),
	...timestamps,
}, (table) => [
	index('idx_team_service_credentials_connection').on(table.connectionId, table.status),
	uniqueIndex('idx_team_service_credentials_connection_definition').on(table.connectionId, table.definitionId),
]);

export const teamVaults = pgTable('team_vaults', {
	teamId: text('team_id').primaryKey(),
	status: text('status').notNull().default('active'),
	encryptionVersion: text('encryption_version').notNull(),
	activeKeyVersion: integer('active_key_version').notNull().default(1),
	recoveryMode: text('recovery_mode').notNull().default('administrator-regrant'),
	createdByUserId: text('created_by_user_id').notNull(),
	...timestamps,
});

export const userVaultKeys = pgTable('user_vault_keys', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	publicKey: text('public_key').notNull(),
	encryptedPrivateKeyEnvelopeJson: text('encrypted_private_key_envelope_json').notNull(),
	status: text('status').notNull().default('active'),
	version: integer('version').notNull().default(1),
	...timestamps,
}, (table) => [
	index('idx_user_vault_keys_user_status').on(table.userId, table.status),
	uniqueIndex('idx_user_vault_keys_user_version').on(table.userId, table.version),
]);

export const teamVaultGrants = pgTable('team_vault_grants', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	userId: text('user_id').notNull(),
	userVaultKeyId: text('user_vault_key_id').notNull(),
	keyVersion: integer('key_version').notNull(),
	wrappedTeamVaultKey: text('wrapped_team_vault_key').notNull(),
	status: text('status').notNull().default('active'),
	grantedByUserId: text('granted_by_user_id').notNull(),
	revokedByUserId: text('revoked_by_user_id'),
	revokedAt: text('revoked_at'),
	...timestamps,
}, (table) => [
	index('idx_team_vault_grants_team_status').on(table.teamId, table.status),
	uniqueIndex('idx_team_vault_grants_team_user_key').on(table.teamId, table.userId, table.keyVersion),
]);

export const credentialEnvelopes = pgTable('credential_envelopes', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	connectionId: text('connection_id').notNull(),
	credentialProfileId: text('credential_profile_id').notNull(),
	fieldKey: text('field_key').notNull(),
	envelopeJson: text('envelope_json').notNull(),
	fingerprint: text('fingerprint').notNull(),
	keyVersion: integer('key_version').notNull(),
	status: text('status').notNull().default('active'),
	...timestamps,
}, (table) => [
	index('idx_credential_envelopes_connection_status').on(table.connectionId, table.status),
	uniqueIndex('idx_credential_envelopes_profile_field').on(table.credentialProfileId, table.fieldKey, table.keyVersion),
]);

export const externalVaultBindings = pgTable('external_vault_bindings', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	connectionId: text('connection_id').notNull(),
	provider: text('provider').notNull(),
	referenceJson: text('reference_json').notNull(),
	authMode: text('auth_mode').notNull(),
	status: text('status').notNull().default('active'),
	lastValidatedAt: text('last_validated_at'),
	...timestamps,
}, (table) => [
	index('idx_external_vault_bindings_team_status').on(table.teamId, table.status),
]);

export const secretOperationLeases = pgTable('secret_operation_leases', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	connectionId: text('connection_id').notNull(),
	capabilityType: text('capability_type').notNull(),
	purpose: text('purpose').notNull(),
	resourceScopeJson: text('resource_scope_json').notNull().default('{}'),
	credentialProfileId: text('credential_profile_id').notNull(),
	actorUserId: text('actor_user_id').notNull(),
	requiredFieldsJson: text('required_fields_json').notNull(),
	publicKey: text('public_key').notNull(),
	sealedPayload: text('sealed_payload'),
	status: text('status').notNull().default('pending'),
	operationCorrelationId: text('operation_correlation_id').notNull(),
	idempotencyKey: text('idempotency_key').notNull(),
	expiresAt: text('expires_at').notNull(),
	consumedAt: text('consumed_at'),
	cancelledAt: text('cancelled_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_secret_operation_leases_team_status').on(table.teamId, table.status, table.expiresAt),
	uniqueIndex('idx_secret_operation_leases_idempotency').on(table.teamId, table.idempotencyKey),
]);
