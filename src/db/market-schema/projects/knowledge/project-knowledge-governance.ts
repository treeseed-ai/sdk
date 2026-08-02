import { index,integer,pgTable,text,uniqueIndex } from 'drizzle-orm/pg-core';

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

export const hubRepositories = pgTable('hub_repositories', {
	id: text('id').primaryKey(),
	hubId: text('hub_id').notNull(),
	teamId: text('team_id').notNull(),
	role: text('role').notNull(),
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
