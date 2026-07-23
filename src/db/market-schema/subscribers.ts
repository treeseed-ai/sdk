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
