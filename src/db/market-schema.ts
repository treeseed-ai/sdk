import { bigint, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';

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

export const workDays = pgTable('work_days', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	state: text('state').notNull(),
	capacityBudget: integer('capacity_budget').notNull().default(0),
	capacityUsed: integer('capacity_used').notNull().default(0),
	graphVersion: text('graph_version'),
	summaryJson: text('summary_json'),
	startedAt: text('started_at').notNull(),
	endedAt: text('ended_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const graphRuns = pgTable('graph_runs', {
	id: text('id').primaryKey(),
	workDayId: text('work_day_id').notNull(),
	corpusHash: text('corpus_hash').notNull(),
	graphVersion: text('graph_version').notNull(),
	queryJson: text('query_json'),
	seedIdsJson: text('seed_ids_json'),
	selectedNodeIdsJson: text('selected_node_ids_json'),
	statsJson: text('stats_json'),
	snapshotRef: text('snapshot_ref'),
	createdAt: text('created_at').notNull(),
});

export const reports = pgTable('reports', {
	id: text('id').primaryKey(),
	workDayId: text('work_day_id').notNull(),
	kind: text('kind').notNull(),
	bodyJson: text('body_json').notNull(),
	renderedRef: text('rendered_ref'),
	sentAt: text('sent_at'),
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

export const agentPools = pgTable('agent_pools', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	teamId: text('team_id').notNull(),
	environment: text('environment').notNull(),
	name: text('name').notNull(),
	registrationIdentity: text('registration_identity'),
	serviceBaseUrl: text('service_base_url'),
	status: text('status').notNull().default('pending'),
	minWorkers: integer('min_workers').notNull().default(0),
	maxWorkers: integer('max_workers').notNull().default(1),
	targetQueueDepth: integer('target_queue_depth').notNull().default(1),
	cooldownSeconds: integer('cooldown_seconds').notNull().default(60),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_agent_pools_project_environment_name').on(table.projectId, table.environment, table.name)
]);

export const agentPoolRegistrations = pgTable('agent_pool_registrations', {
	id: text('id').primaryKey(),
	poolId: text('pool_id').notNull(),
	projectId: text('project_id').notNull(),
	runnerId: text('runner_id'),
	managerId: text('manager_id'),
	serviceName: text('service_name'),
	heartbeatAt: text('heartbeat_at').notNull(),
	desiredWorkers: integer('desired_workers'),
	observedQueueDepth: integer('observed_queue_depth'),
	observedActiveLeases: integer('observed_active_leases'),
	metadataJson: text('metadata_json'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_agent_pool_registrations_pool_heartbeat').on(table.poolId, table.heartbeatAt)
]);

export const agentPoolScaleDecisions = pgTable('agent_pool_scale_decisions', {
	id: text('id').primaryKey(),
	poolId: text('pool_id').notNull(),
	projectId: text('project_id').notNull(),
	environment: text('environment').notNull(),
	desiredWorkers: integer('desired_workers').notNull(),
	observedQueueDepth: integer('observed_queue_depth').notNull().default(0),
	observedActiveLeases: integer('observed_active_leases').notNull().default(0),
	workDayId: text('work_day_id'),
	reason: text('reason').notNull(),
	metadataJson: text('metadata_json').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_agent_pool_scale_decisions_pool_created').on(table.poolId, table.createdAt)
]);

export const projectWorkdaySummaries = pgTable('project_workday_summaries', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	environment: text('environment').notNull(),
	workDayId: text('work_day_id').notNull(),
	kind: text('kind').notNull(),
	state: text('state'),
	startedAt: text('started_at'),
	endedAt: text('ended_at'),
	summaryJson: text('summary_json').notNull(),
	metadataJson: text('metadata_json').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_project_workday_summaries_project_environment_created').on(table.projectId, table.environment, table.createdAt)
]);

export const workPolicies = pgTable('work_policies', {
	projectId: text('project_id'),
	environment: text('environment'),
	scheduleJson: text('schedule_json').notNull(),
	dailyTaskCreditBudget: integer('daily_task_credit_budget').notNull().default(0),
	maxQueuedTasks: integer('max_queued_tasks').notNull().default(0),
	maxQueuedCredits: integer('max_queued_credits').notNull().default(0),
	autoscaleJson: text('autoscale_json').notNull(),
	creditWeightsJson: text('credit_weights_json').notNull(),
	metadataJson: text('metadata_json').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	enabled: integer('enabled').notNull().default(1),
	startCron: text('start_cron').notNull().default('0 9 * * 1-5'),
	durationMinutes: integer('duration_minutes').notNull().default(480),
	maxRunners: integer('max_runners').notNull().default(1),
	maxWorkersPerRunner: integer('max_workers_per_runner').notNull().default(4),
	dailyCreditBudget: integer('daily_credit_budget').notNull().default(0),
	closeoutGraceMinutes: integer('closeout_grace_minutes').notNull().default(15),
}, (table) => [
	primaryKey({ columns: [table.projectId, table.environment] })
]);

export const priorityOverrides = pgTable('priority_overrides', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	model: text('model').notNull(),
	subjectId: text('subject_id').notNull(),
	priority: real('priority').notNull().default(0),
	estimatedCredits: real('estimated_credits'),
	metadataJson: text('metadata_json').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_priority_overrides_project_priority').on(table.projectId, table.priority, table.updatedAt)
]);

export const prioritySnapshots = pgTable('priority_snapshots', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	workDayId: text('work_day_id'),
	snapshotJson: text('snapshot_json').notNull(),
	metadataJson: text('metadata_json').notNull(),
	generatedAt: text('generated_at').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_priority_snapshots_project_generated').on(table.projectId, table.generatedAt)
]);

export const taskCreditLedger = pgTable('task_credit_ledger', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	workDayId: text('work_day_id').notNull(),
	taskId: text('task_id'),
	phase: text('phase').notNull(),
	credits: real('credits').notNull(),
	metadataJson: text('metadata_json').notNull(),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_task_credit_ledger_work_day_created').on(table.workDayId, table.createdAt)
]);

export const scaleDecisions = pgTable('scale_decisions', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	environment: text('environment').notNull(),
	poolName: text('pool_name').notNull(),
	workDayId: text('work_day_id'),
	desiredWorkers: integer('desired_workers').notNull(),
	observedQueueDepth: integer('observed_queue_depth').notNull().default(0),
	observedActiveLeases: integer('observed_active_leases').notNull().default(0),
	reason: text('reason').notNull(),
	metadataJson: text('metadata_json').notNull(),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_scale_decisions_project_environment_pool_created').on(table.projectId, table.environment, table.poolName, table.createdAt)
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
	teamId: text('team_id'),
	ownerTeamId: text('owner_team_id'),
	name: text('name').notNull(),
	kind: text('kind').notNull(),
	status: text('status').notNull().default('pending'),
	provider: text('provider').notNull(),
	billingScope: text('billing_scope').notNull().default('team'),
	monthlyCreditBudget: real('monthly_credit_budget').notNull().default(0),
	dailyCreditBudget: real('daily_credit_budget').notNull().default(0),
	creditBudgetMode: text('credit_budget_mode').notNull().default('derived'),
	maxConcurrentWorkdays: integer('max_concurrent_workdays').notNull().default(1),
	maxConcurrentWorkers: integer('max_concurrent_workers').notNull().default(1),
	capacityModelJson: text('capacity_model_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_capacity_providers_team_status').on(table.teamId, table.status, table.provider)
]);

export const capacityProviderHosts = pgTable('capacity_provider_hosts', {
	id: text('id').primaryKey(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	hostId: text('host_id').notNull(),
	role: text('role').notNull(),
	required: integer('required').notNull().default(1),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_capacity_provider_hosts_unique').on(table.capacityProviderId, table.hostId, table.role)
]);

export const capacityProviderLanes = pgTable('capacity_provider_lanes', {
	id: text('id').primaryKey(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	name: text('name').notNull(),
	businessModel: text('business_model').notNull().default('custom'),
	modelFamily: text('model_family'),
	modelClass: text('model_class'),
	regionPolicy: text('region_policy'),
	unit: text('unit').notNull().default('treeseed_credit'),
	scarcityLevel: text('scarcity_level').notNull().default('medium'),
	hardLimitsJson: text('hard_limits_json').notNull().default('{}'),
	routingPolicyJson: text('routing_policy_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_capacity_provider_lanes_provider').on(table.capacityProviderId, table.businessModel, table.scarcityLevel)
]);

export const capacityGrants = pgTable('capacity_grants', {
	id: text('id').primaryKey(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	laneId: text('lane_id'),
	grantScope: text('grant_scope').notNull().default('team'),
	teamId: text('team_id').notNull(),
	projectId: text('project_id'),
	environment: text('environment'),
	state: text('state').notNull().default('active'),
	dailyCreditLimit: real('daily_credit_limit'),
	weeklyCreditLimit: real('weekly_credit_limit'),
	monthlyCreditLimit: real('monthly_credit_limit'),
	dailyUsdLimit: real('daily_usd_limit'),
	weeklyQuotaMinutes: real('weekly_quota_minutes'),
	monthlyProviderUnits: real('monthly_provider_units'),
	priorityWeight: real('priority_weight').notNull().default(1),
	overflowPolicy: text('overflow_policy').notNull().default('soft_grant'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_capacity_grants_team_project').on(table.teamId, table.projectId, table.state),
	index('idx_capacity_grants_provider_lane').on(table.capacityProviderId, table.laneId, table.state)
]);

export const capacityReservations = pgTable('capacity_reservations', {
	id: text('id').primaryKey(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	executionProviderId: text('execution_provider_id'),
	laneId: text('lane_id').notNull(),
	allocationSetId: text('allocation_set_id'),
	projectAgentClassId: text('project_agent_class_id'),
	assignmentId: text('assignment_id'),
	mode: text('mode'),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	workDayId: text('work_day_id'),
	taskId: text('task_id'),
	state: text('state').notNull().default('reserved'),
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
	index('idx_capacity_reservations_project_workday_state').on(table.projectId, table.workDayId, table.state, table.createdAt),
	index('idx_capacity_reservations_provider_state').on(table.capacityProviderId, table.laneId, table.state),
	index('idx_capacity_reservations_execution_provider_state').on(table.executionProviderId, table.state, table.createdAt)
]);

export const capacityLedgerEntries = pgTable('capacity_ledger_entries', {
	id: text('id').primaryKey(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	laneId: text('lane_id'),
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
	index('idx_capacity_ledger_project_workday_created').on(table.projectId, table.workDayId, table.createdAt)
]);

export const capacityRoutingDecisions = pgTable('capacity_routing_decisions', {
	id: text('id').primaryKey(),
	taskId: text('task_id'),
	workDayId: text('work_day_id'),
	projectId: text('project_id').notNull(),
	selectedProviderId: text('selected_provider_id').notNull(),
	selectedLaneId: text('selected_lane_id').notNull(),
	selectedModel: text('selected_model'),
	decision: text('decision').notNull().default('selected'),
	reason: text('reason').notNull(),
	candidateJson: text('candidate_json').notNull().default('[]'),
	scoreJson: text('score_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_capacity_routing_decisions_project_workday').on(table.projectId, table.workDayId, table.createdAt)
]);

export const taskEstimates = pgTable('task_estimates', {
	id: text('id').primaryKey(),
	taskId: text('task_id'),
	workDayId: text('work_day_id'),
	projectId: text('project_id').notNull(),
	estimatePhase: text('estimate_phase').notNull(),
	taskSignature: text('task_signature').notNull(),
	confidence: text('confidence').notNull(),
	estimatedCreditsP50: real('estimated_credits_p50').notNull(),
	estimatedCreditsP90: real('estimated_credits_p90').notNull(),
	reservedCredits: real('reserved_credits').notNull(),
	estimatedInputTokensP50: integer('estimated_input_tokens_p50'),
	estimatedInputTokensP90: integer('estimated_input_tokens_p90'),
	estimatedOutputTokensP50: integer('estimated_output_tokens_p50'),
	estimatedOutputTokensP90: integer('estimated_output_tokens_p90'),
	estimatedQuotaMinutesP50: real('estimated_quota_minutes_p50'),
	estimatedQuotaMinutesP90: real('estimated_quota_minutes_p90'),
	featuresJson: text('features_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	executionProfileId: text('execution_profile_id').notNull().default('standard-code-model'),
}, (table) => [
	index('idx_task_estimates_project_signature').on(table.projectId, table.taskSignature, table.createdAt),
	index('idx_task_estimates_project_signature_profile').on(table.projectId, table.taskSignature, table.executionProfileId, table.createdAt)
]);

export const taskUsageActuals = pgTable('task_usage_actuals', {
	id: text('id').primaryKey(),
	taskId: text('task_id'),
	workDayId: text('work_day_id'),
	projectId: text('project_id').notNull(),
	taskSignature: text('task_signature').notNull(),
	assignmentId: text('assignment_id'),
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
	index('idx_task_usage_actuals_project_signature').on(table.projectId, table.taskSignature, table.createdAt),
	index('idx_task_usage_actuals_project_signature_profile').on(table.projectId, table.taskSignature, table.executionProfileId, table.createdAt),
	index('idx_task_usage_actuals_execution_provider').on(table.executionProviderId, table.createdAt)
]);

export const nativeUsageObservations = pgTable('native_usage_observations', {
	id: text('id').primaryKey(),
	taskUsageActualId: text('task_usage_actual_id'),
	taskId: text('task_id'),
	workDayId: text('work_day_id'),
	projectId: text('project_id').notNull(),
	taskSignature: text('task_signature').notNull(),
	executionProfileId: text('execution_profile_id').notNull().default('standard-code-model'),
	capacityProviderId: text('capacity_provider_id'),
	executionProviderId: text('execution_provider_id'),
	nativeUnit: text('native_unit'),
	nativeUsageJson: text('native_usage_json').notNull().default('{}'),
	observedAt: text('observed_at').notNull(),
	source: text('source').notNull().default('provider_report'),
	formulaVersion: text('formula_version').notNull().default('treeseed.actual-credits.v1'),
	actualCredits: real('actual_credits').notNull(),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_native_usage_observations_profile').on(table.projectId, table.taskSignature, table.executionProfileId, table.createdAt),
	index('idx_native_usage_observations_provider').on(table.executionProviderId, table.createdAt)
]);

export const capacityAllocationSets = pgTable('capacity_allocation_sets', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	version: text('version').notNull(),
	status: text('status').notNull().default('draft'),
	effectiveFrom: text('effective_from'),
	effectiveUntil: text('effective_until'),
	policyJson: text('policy_json').notNull().default('{}'),
	slicesJson: text('slices_json').notNull().default('[]'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdById: text('created_by_id'),
	activatedAt: text('activated_at'),
	supersededById: text('superseded_by_id'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_capacity_allocation_sets_team_status').on(table.teamId, table.status, table.version),
	index('idx_capacity_allocation_sets_team_created').on(table.teamId, table.createdAt)
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
	uniqueIndex('idx_project_agent_classes_project_slug').on(table.projectId, table.slug),
	index('idx_project_agent_classes_team_project').on(table.teamId, table.projectId, table.status)
]);

export const providerAvailabilitySessions = pgTable('provider_availability_sessions', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	registrationId: text('registration_id'),
	environment: text('environment'),
	status: text('status').notNull().default('open'),
	checkedInAt: text('checked_in_at').notNull(),
	availableFrom: text('available_from'),
	availableUntil: text('available_until'),
	executionProvidersJson: text('execution_providers_json').notNull().default('[]'),
	capabilitiesJson: text('capabilities_json').notNull().default('[]'),
	grantsJson: text('grants_json').notNull().default('[]'),
	nativeLimitsJson: text('native_limits_json').notNull().default('{}'),
	runnerPressureJson: text('runner_pressure_json').notNull().default('{}'),
	constraintsJson: text('constraints_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	closedAt: text('closed_at'),
}, (table) => [
	index('idx_provider_availability_sessions_provider_status').on(table.capacityProviderId, table.status, table.checkedInAt),
	index('idx_provider_availability_sessions_team_status').on(table.teamId, table.status, table.checkedInAt)
]);

export const providerAssignments = pgTable('provider_assignments', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	providerSessionId: text('provider_session_id'),
	executionProviderId: text('execution_provider_id'),
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
	index('idx_provider_assignments_provider_status').on(table.capacityProviderId, table.status, table.leaseExpiresAt),
	index('idx_provider_assignments_project_mode').on(table.projectId, table.mode, table.status),
	index('idx_provider_assignments_lease').on(table.capacityProviderId, table.leaseState, table.leaseExpiresAt),
	index('idx_provider_assignments_runner').on(table.runnerId, table.leaseState),
	uniqueIndex('idx_provider_assignments_synthesis_key').on(table.teamId, table.synthesisKey),
	index('idx_provider_assignments_decision').on(table.decisionId, table.status),
	index('idx_provider_assignments_team_created').on(table.teamId, table.createdAt)
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
	index('idx_agent_mode_runs_assignment').on(table.providerAssignmentId, table.status),
	index('idx_agent_mode_runs_project_mode').on(table.projectId, table.mode, table.createdAt),
	index('idx_agent_mode_runs_provider').on(table.capacityProviderId, table.createdAt)
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
	uniqueIndex('idx_decision_planning_statuses_decision').on(table.decisionId),
	index('idx_decision_planning_statuses_project').on(table.projectId, table.executionReadiness, table.updatedAt)
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
	index('idx_planning_input_requests_decision').on(table.decisionId, table.status, table.requestedAt),
	index('idx_planning_input_requests_project').on(table.projectId, table.status, table.requestedAt)
]);

export const decisionExecutionInputs = pgTable('decision_execution_inputs', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	decisionId: text('decision_id').notNull(),
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
	index('idx_decision_execution_inputs_decision').on(table.decisionId, table.status, table.createdAt),
	index('idx_decision_execution_inputs_project').on(table.projectId, table.status, table.mode, table.createdAt)
]);

export const workdayCapacityEnvelopes = pgTable('workday_capacity_envelopes', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	projectId: text('project_id').notNull(),
	allocationSetId: text('allocation_set_id'),
	status: text('status').notNull().default('draft'),
	startedAt: text('started_at'),
	pausedAt: text('paused_at'),
	completedAt: text('completed_at'),
	envelopeJson: text('envelope_json').notNull().default('{}'),
	modeSplitsJson: text('mode_splits_json').notNull().default('{}'),
	capsJson: text('caps_json').notNull().default('{}'),
	reservesJson: text('reserves_json').notNull().default('{}'),
	borrowingRulesJson: text('borrowing_rules_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_workday_capacity_envelopes_project_status').on(table.projectId, table.status, table.createdAt),
	index('idx_workday_capacity_envelopes_team_status').on(table.teamId, table.status, table.createdAt)
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
	index('idx_agent_capacity_plans_decision').on(table.decisionId, table.status, table.createdAt),
	index('idx_agent_capacity_plans_project').on(table.projectId, table.status, table.createdAt),
	index('idx_agent_capacity_plans_workday').on(table.workDayId, table.status, table.createdAt)
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

export const workdayRequests = pgTable('workday_requests', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	environment: text('environment').notNull(),
	typeColumn: text('type').notNull(),
	state: text('state').notNull().default('pending'),
	workDayId: text('work_day_id'),
	requestedBy: text('requested_by'),
	reason: text('reason'),
	payloadJson: text('payload_json').notNull(),
	metadataJson: text('metadata_json').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_workday_requests_project_environment_state').on(table.projectId, table.environment, table.state, table.createdAt)
]);

export const workdayManagerLeases = pgTable('workday_manager_leases', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	environment: text('environment').notNull(),
	workDayId: text('work_day_id'),
	managerId: text('manager_id').notNull(),
	state: text('state').notNull().default('active'),
	heartbeatAt: text('heartbeat_at').notNull(),
	expiresAt: text('expires_at').notNull(),
	metadataJson: text('metadata_json').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_workday_manager_leases_active').on(table.projectId, table.environment, table.state, table.heartbeatAt)
]);

export const workerRunners = pgTable('worker_runners', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	environment: text('environment').notNull(),
	runnerId: text('runner_id').notNull(),
	runnerServiceName: text('runner_service_name').notNull(),
	volumeIdentity: text('volume_identity').notNull(),
	state: text('state').notNull().default('active'),
	maxLocalWorkers: integer('max_local_workers').notNull().default(4),
	activeLocalWorkers: integer('active_local_workers').notNull().default(0),
	availableCapacity: integer('available_capacity').notNull().default(4),
	lastHeartbeatAt: text('last_heartbeat_at'),
	claimedRepositoryIdsJson: text('claimed_repository_ids_json').notNull(),
	metadataJson: text('metadata_json').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_worker_runners_identity').on(table.projectId, table.environment, table.runnerId),
	index('idx_worker_runners_state_capacity').on(table.projectId, table.environment, table.state, table.availableCapacity)
]);

export const repositoryClaims = pgTable('repository_claims', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	repositoryId: text('repository_id').notNull(),
	runnerId: text('runner_id').notNull(),
	runnerServiceName: text('runner_service_name').notNull(),
	volumeIdentity: text('volume_identity').notNull(),
	lastSeenCommit: text('last_seen_commit'),
	lastTaskAt: text('last_task_at'),
	claimState: text('claim_state').notNull().default('active'),
	metadataJson: text('metadata_json').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	uniqueIndex('idx_repository_claims_runner_repo').on(table.projectId, table.repositoryId, table.runnerId),
	index('idx_repository_claims_repo_state').on(table.projectId, table.repositoryId, table.claimState, table.updatedAt)
]);

export const runnerScaleDecisions = pgTable('runner_scale_decisions', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	environment: text('environment').notNull(),
	workDayId: text('work_day_id'),
	runnerId: text('runner_id'),
	runnerServiceName: text('runner_service_name'),
	action: text('action').notNull(),
	reason: text('reason').notNull(),
	metadataJson: text('metadata_json').notNull(),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_runner_scale_decisions_project_workday').on(table.projectId, table.environment, table.workDayId, table.createdAt)
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

export const capacityProviderApiKeys = pgTable('capacity_provider_api_keys', {
	id: text('id').primaryKey(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	teamId: text('team_id').notNull(),
	name: text('name').notNull(),
	keyPrefix: text('key_prefix').notNull(),
	keyHash: text('key_hash').notNull(),
	scopesJson: text('scopes_json').notNull().default('[]'),
	status: text('status').notNull().default('active'),
	lastUsedAt: text('last_used_at'),
	rotatedFromKeyId: text('rotated_from_key_id'),
	expiresAt: text('expires_at'),
	revokedAt: text('revoked_at'),
	createdById: text('created_by_id'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_capacity_provider_api_keys_provider_status').on(table.capacityProviderId, table.status, table.createdAt),
	index('idx_capacity_provider_api_keys_prefix').on(table.keyPrefix)
]);

export const userPreferences = pgTable('user_preferences', {
	userId: text('user_id').primaryKey(),
	colorScheme: text('color_scheme').notNull().default('fern'),
	themeMode: text('theme_mode').notNull().default('system'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const taskEstimateProfiles = pgTable('task_estimate_profiles', {
	taskSignature: text('task_signature'),
	executionProfileId: text('execution_profile_id').default('standard-code-model'),
	sampleCount: integer('sample_count').notNull().default(0),
	completedSampleCount: integer('completed_sample_count').notNull().default(0),
	interruptedSampleCount: integer('interrupted_sample_count').notNull().default(0),
	inputTokensP50: integer('input_tokens_p50'),
	inputTokensP90: integer('input_tokens_p90'),
	outputTokensP50: integer('output_tokens_p50'),
	outputTokensP90: integer('output_tokens_p90'),
	quotaMinutesP50: real('quota_minutes_p50'),
	quotaMinutesP90: real('quota_minutes_p90'),
	filesChangedP50: real('files_changed_p50'),
	filesChangedP90: real('files_changed_p90'),
	creditsP50: real('credits_p50'),
	creditsP90: real('credits_p90'),
	creditsVariance: real('credits_variance'),
	confidenceScore: real('confidence_score'),
	outlierCount: integer('outlier_count').notNull().default(0),
	partialCredits: real('partial_credits'),
	firstSampleAt: text('first_sample_at'),
	lastSampleAt: text('last_sample_at'),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	primaryKey({ columns: [table.taskSignature, table.executionProfileId] })
]);

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
	index('idx_credit_conversion_profiles_kind_unit').on(table.executionProviderKind, table.nativeUnit, table.updatedAt)
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

export const capacityProviderRegistrations = pgTable('capacity_provider_registrations', {
	id: text('id').primaryKey(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	teamId: text('team_id').notNull(),
	runtimeVersion: text('runtime_version').notNull(),
	marketId: text('market_id').notNull(),
	capabilitiesJson: text('capabilities_json').notNull().default('[]'),
	budgetsJson: text('budgets_json').notNull().default('{}'),
	healthJson: text('health_json').notNull().default('{}'),
	status: text('status').notNull().default('online'),
	registeredAt: text('registered_at').notNull(),
	lastSeenAt: text('last_seen_at').notNull(),
	disconnectedAt: text('disconnected_at'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_capacity_provider_registrations_provider_seen').on(table.capacityProviderId, table.lastSeenAt)
]);

export const capacityProviderDeployments = pgTable('capacity_provider_deployments', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	capacityProviderId: text('capacity_provider_id').notNull(),
	launchMode: text('launch_mode').notNull(),
	hostKind: text('host_kind').notNull(),
	hostId: text('host_id'),
	status: text('status').notNull(),
	imageRef: text('image_ref'),
	serviceRefsJson: text('service_refs_json').notNull().default('{}'),
	envRefsJson: text('env_refs_json').notNull().default('{}'),
	resultJson: text('result_json').notNull().default('{}'),
	errorJson: text('error_json'),
	createdById: text('created_by_id'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	completedAt: text('completed_at'),
}, (table) => [
	index('idx_capacity_provider_deployments_provider_created').on(table.capacityProviderId, table.createdAt)
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

export const executionProviders = pgTable('execution_providers', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	capacityProviderId: text('capacity_provider_id'),
	name: text('name').notNull(),
	kind: text('kind').notNull(),
	status: text('status').notNull().default('active'),
	nativeUnit: text('native_unit').notNull(),
	quotaVisibility: text('quota_visibility').notNull().default('opaque'),
	maxConcurrentWorkers: integer('max_concurrent_workers').notNull().default(1),
	resetCadence: text('reset_cadence'),
	configJson: text('config_json').notNull().default('{}'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_execution_providers_team_status').on(table.teamId, table.status, table.kind),
	index('idx_execution_providers_capacity_provider').on(table.capacityProviderId, table.status)
]);

export const executionProviderNativeLimits = pgTable('execution_provider_native_limits', {
	id: text('id').primaryKey(),
	executionProviderId: text('execution_provider_id').notNull(),
	scope: text('scope').notNull(),
	nativeUnit: text('native_unit').notNull(),
	limitAmount: real('limit_amount').notNull(),
	reserveBufferPercent: real('reserve_buffer_percent').notNull().default(0),
	resetCadence: text('reset_cadence'),
	resetAt: text('reset_at'),
	confidence: text('confidence').notNull().default('estimated'),
	source: text('source').notNull().default('configured'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
}, (table) => [
	index('idx_execution_provider_native_limits_provider_scope').on(table.executionProviderId, table.scope, table.nativeUnit)
]);

export const executionProviderObservations = pgTable('execution_provider_observations', {
	id: text('id').primaryKey(),
	executionProviderId: text('execution_provider_id').notNull(),
	observedAt: text('observed_at').notNull(),
	health: text('health').notNull().default('unknown'),
	activeWorkers: integer('active_workers'),
	queuedTasks: integer('queued_tasks'),
	throttleState: text('throttle_state'),
	nativeRemainingJson: text('native_remaining_json').notNull().default('{}'),
	resetAt: text('reset_at'),
	confidence: text('confidence').notNull().default('estimated'),
	metadataJson: text('metadata_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
}, (table) => [
	index('idx_execution_provider_observations_provider_observed').on(table.executionProviderId, table.observedAt)
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
	workDays,
	graphRuns,
	reports,
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
	projectHosting,
	projectEnvironments,
	projectInfrastructureResources,
	projectDeployments,
	projectDeploymentEvents,
	agentPools,
	agentPoolRegistrations,
	agentPoolScaleDecisions,
	projectWorkdaySummaries,
	workPolicies,
	priorityOverrides,
	prioritySnapshots,
	taskCreditLedger,
	scaleDecisions,
	projectSummarySnapshots,
	teamInboxItems,
	betterAuthUser,
	betterAuthSession,
	betterAuthAccount,
	betterAuthVerification,
	teamWebHosts,
	teamInvites,
	capacityProviders,
	capacityProviderHosts,
	capacityProviderLanes,
	capacityGrants,
	capacityReservations,
	capacityLedgerEntries,
	capacityRoutingDecisions,
	taskEstimates,
	taskUsageActuals,
	nativeUsageObservations,
	approvalRequests,
	workdayRequests,
	workdayManagerLeases,
	workerRunners,
	repositoryClaims,
	runnerScaleDecisions,
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
	capacityProviderApiKeys,
	userPreferences,
	taskEstimateProfiles,
	creditConversionProfiles,
	seedRuns,
	runtimeRecords,
	cursorState,
	leaseState,
	messageQueue,
	capacityProviderRegistrations,
	capacityProviderDeployments,
	capacityAllocationSets,
	projectAgentClasses,
	providerAvailabilitySessions,
	providerAssignments,
	agentModeRuns,
	platformOperations,
	platformOperationEvents,
	marketOperationRunners,
	platformRepositoryClaims,
	executionProviders,
	executionProviderNativeLimits,
	executionProviderObservations,
	marketAuthCredentials,
	marketAuthPasswordResets,
};

export type TreeseedMarketDrizzleSchema = typeof treeseedMarketSchema;
