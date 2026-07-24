import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';


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
