import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const betterAuthUser = sqliteTable('better_auth_user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	username: text('username').unique(),
	firstName: text('firstName'),
	lastName: text('lastName'),
	emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
	image: text('image'),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});

export const betterAuthSession = sqliteTable('better_auth_session', {
	id: text('id').primaryKey(),
	expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
	ipAddress: text('ipAddress'),
	userAgent: text('userAgent'),
	userId: text('userId').notNull().references(() => betterAuthUser.id, { onDelete: 'cascade' }),
});

export const betterAuthAccount = sqliteTable('better_auth_account', {
	id: text('id').primaryKey(),
	accountId: text('accountId').notNull(),
	providerId: text('providerId').notNull(),
	userId: text('userId').notNull().references(() => betterAuthUser.id, { onDelete: 'cascade' }),
	accessToken: text('accessToken'),
	refreshToken: text('refreshToken'),
	idToken: text('idToken'),
	accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
	refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
	scope: text('scope'),
	password: text('password'),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
	uniqueIndex('idx_better_auth_account_provider_account').on(table.providerId, table.accountId),
]);

export const betterAuthVerification = sqliteTable('better_auth_verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	email: text('email'),
	username: text('username').unique(),
	displayName: text('display_name'),
	status: text('status').notNull().default('active'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const userIdentities = sqliteTable('user_identities', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	provider: text('provider').notNull(),
	providerSubject: text('provider_subject').notNull(),
	email: text('email'),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	profileJson: text('profile_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_user_identities_provider_subject').on(table.provider, table.providerSubject),
]);

export const roles = sqliteTable('roles', {
	id: text('id').primaryKey(),
	key: text('key').notNull().unique(),
	description: text('description'),
	createdAt: text('created_at').notNull(),
});

export const permissions = sqliteTable('permissions', {
	id: text('id').primaryKey(),
	key: text('key').notNull().unique(),
	resource: text('resource').notNull(),
	action: text('action').notNull(),
	scope: text('scope').notNull(),
	description: text('description'),
	createdAt: text('created_at').notNull(),
});

export const rolePermissions = sqliteTable('role_permissions', {
	roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
	permissionId: text('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
	createdAt: text('created_at').notNull(),
}, (table) => [
	primaryKey({ columns: [table.roleId, table.permissionId] }),
]);

export const userRoleBindings = sqliteTable('user_role_bindings', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
	createdAt: text('created_at').notNull(),
}, (table) => [
	uniqueIndex('idx_user_role_bindings_user_role').on(table.userId, table.roleId),
]);

export const teams = sqliteTable('teams', {
	id: text('id').primaryKey(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull().unique(),
	displayName: text('display_name'),
	logoUrl: text('logo_url'),
	profileSummary: text('profile_summary'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const teamInvites = sqliteTable('team_invites', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
	email: text('email').notNull(),
	roleKey: text('role_key').notNull(),
	tokenPrefix: text('token_prefix').notNull(),
	tokenHash: text('token_hash').notNull(),
	status: text('status').notNull().default('pending'),
	invitedByUserId: text('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
	acceptedByUserId: text('accepted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
	acceptedAt: text('accepted_at'),
	expiresAt: text('expires_at').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_team_invites_team_status').on(table.teamId, table.status, table.createdAt),
	index('idx_team_invites_token_prefix').on(table.tokenPrefix),
]);

export const teamMemberships = sqliteTable('team_memberships', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	status: text('status').notNull().default('active'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_team_memberships_team_user').on(table.teamId, table.userId),
]);

export const webSessions = sqliteTable('web_sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	identityId: text('identity_id'),
	betterAuthSessionId: text('better_auth_session_id'),
	provider: text('provider').notNull(),
	providerSubject: text('provider_subject').notNull(),
	email: text('email'),
	displayName: text('display_name'),
	principalJson: text('principal_json').notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	authenticatedAt: text('authenticated_at').notNull(),
	lastSeenAt: text('last_seen_at').notNull(),
	expiresAt: text('expires_at').notNull(),
	revokedAt: text('revoked_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const projects = sqliteTable('projects', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
	slug: text('slug').notNull(),
	name: text('name').notNull(),
	description: text('description'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_projects_team_slug').on(table.teamId, table.slug),
]);

export const remoteJobs = sqliteTable('remote_jobs', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
	namespace: text('namespace').notNull(),
	operation: text('operation').notNull(),
	status: text('status').notNull(),
	preferredMode: text('preferred_mode'),
	selectedTarget: text('selected_target'),
	requestedByType: text('requested_by_type').notNull(),
	requestedById: text('requested_by_id'),
	inputJson: text('input_json'),
	outputJson: text('output_json'),
	errorJson: text('error_json'),
	idempotencyKey: text('idempotency_key'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	startedAt: text('started_at'),
	finishedAt: text('finished_at'),
});

export const treeseedSchema = {
	better_auth_user: betterAuthUser,
	better_auth_session: betterAuthSession,
	better_auth_account: betterAuthAccount,
	better_auth_verification: betterAuthVerification,
	user: betterAuthUser,
	session: betterAuthSession,
	account: betterAuthAccount,
	verification: betterAuthVerification,
	users,
	userIdentities,
	roles,
	permissions,
	rolePermissions,
	userRoleBindings,
	teams,
	teamInvites,
	teamMemberships,
	webSessions,
	projects,
	remoteJobs,
};

export type TreeseedDrizzleSchema = typeof treeseedSchema;
