import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, real, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';


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
