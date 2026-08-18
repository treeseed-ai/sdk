import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

const timestamps = {
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
};

export const providerCredentialAuthorities = pgTable('provider_credential_authorities', {
	id: text('id').primaryKey(),
	teamId: text('team_id').notNull(),
	connectionId: text('connection_id').notNull(),
	credentialProfileId: text('credential_profile_id').notNull(),
	scheme: text('scheme').notNull(),
	reference: text('reference').notNull(),
	capabilitiesJson: text('capabilities_json').notNull().default('[]'),
	status: text('status').notNull().default('reauthorization-required'),
	version: integer('version').notNull().default(1),
	...timestamps,
}, (table) => [
	index('idx_provider_authorities_team_status').on(table.teamId, table.status),
	uniqueIndex('idx_provider_authorities_connection_profile').on(table.connectionId, table.credentialProfileId),
]);

export const projectRemoteRepositoryBindings = pgTable('project_remote_repository_bindings', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull().unique(),
	teamId: text('team_id').notNull(),
	serviceConnectionId: text('service_connection_id').notNull(),
	capabilityBindingId: text('capability_binding_id').notNull(),
	providerId: text('provider_id').notNull(),
	providerRepositoryId: text('provider_repository_id').notNull(),
	owner: text('owner').notNull(),
	name: text('name').notNull(),
	cloneUrl: text('clone_url').notNull(),
	defaultRef: text('default_ref').notNull(),
	publicationRef: text('publication_ref').notNull(),
	authorityId: text('authority_id').notNull(),
	expectedHead: text('expected_head'),
	observedHead: text('observed_head'),
	grantStatus: text('grant_status').notNull().default('missing'),
	drift: text('drift').notNull().default('unknown'),
	version: integer('version').notNull().default(1),
	...timestamps,
}, (table) => [
	index('idx_remote_repository_team_provider').on(table.teamId, table.providerId),
	uniqueIndex('idx_remote_repository_provider_id').on(table.providerId, table.providerRepositoryId),
]);

export const projectWorkflowOperations = pgTable('project_workflow_operations', {
	id: text('id').primaryKey(),
	projectId: text('project_id').notNull(),
	teamId: text('team_id').notNull(),
	workflowBindingId: text('workflow_binding_id').notNull(),
	repositoryBindingId: text('repository_binding_id').notNull(),
	workflowId: text('workflow_id').notNull(),
	refPolicyJson: text('ref_policy_json').notNull().default('[]'),
	allowedInputsJson: text('allowed_inputs_json').notNull().default('{}'),
	requiredSecretsJson: text('required_secrets_json').notNull().default('[]'),
	requiredVariablesJson: text('required_variables_json').notNull().default('[]'),
	actorPolicyJson: text('actor_policy_json').notNull().default('[]'),
	modePolicyJson: text('mode_policy_json').notNull().default('[]'),
	version: integer('version').notNull().default(1),
	...timestamps,
}, (table) => [
	index('idx_workflow_operations_project').on(table.projectId, table.workflowId),
]);

export const workflowOperationRuns = pgTable('workflow_operation_runs', {
	id: text('id').primaryKey(),
	operationId: text('operation_id').notNull(),
	projectId: text('project_id').notNull(),
	teamId: text('team_id').notNull(),
	actorType: text('actor_type').notNull(),
	actorId: text('actor_id').notNull(),
	mode: text('mode').notNull(),
	assignmentId: text('assignment_id'),
	handleId: text('handle_id'),
	providerId: text('provider_id').notNull(),
	providerRunId: text('provider_run_id'),
	providerRunUrl: text('provider_run_url'),
	sourceSha: text('source_sha').notNull(),
	ref: text('ref').notNull(),
	correlationId: text('correlation_id').notNull().unique(),
	status: text('status').notNull().default('authorizing'),
	artifactsJson: text('artifacts_json').notNull().default('[]'),
	...timestamps,
}, (table) => [
	index('idx_workflow_runs_operation_status').on(table.operationId, table.status, table.updatedAt),
	index('idx_workflow_runs_assignment').on(table.assignmentId, table.status, table.updatedAt),
	uniqueIndex('idx_workflow_runs_provider_id').on(table.providerId, table.providerRunId),
]);

export const remoteGitOperationGrants = pgTable('remote_git_operation_grants', {
	id: text('id').primaryKey(), operationId: text('operation_id').notNull(), actorId: text('actor_id').notNull(),
	teamId: text('team_id').notNull(), projectId: text('project_id').notNull(), repositoryBindingId: text('repository_binding_id').notNull(),
	treeDxNodeId: text('treedx_node_id').notNull(), sourceRef: text('source_ref').notNull(), destinationRef: text('destination_ref').notNull(),
	reviewedCommit: text('reviewed_commit').notNull(), expectedRemoteHead: text('expected_remote_head').notNull(),
	credentialAuthorityId: text('credential_authority_id').notNull(), status: text('status').notNull().default('pending'),
	expiresAt: text('expires_at').notNull(), idempotencyKey: text('idempotency_key').notNull().unique(), ...timestamps,
}, (table) => [index('idx_remote_git_grants_status').on(table.status, table.expiresAt)]);

export const remoteCredentialDeliveries = pgTable('remote_credential_deliveries', {
	id: text('id').primaryKey(), grantId: text('grant_id').notNull().unique(), operationId: text('operation_id').notNull(),
	nodeId: text('node_id').notNull(), operationKind: text('operation_kind').notNull(),
	allowedHost: text('allowed_host').notNull(), refspecDigest: text('refspec_digest').notNull(),
	deliveryMode: text('delivery_mode').notNull(), ciphertext: text('ciphertext'), algorithm: text('algorithm'), status: text('status').notNull().default('ready'),
	expiresAt: text('expires_at').notNull(), consumedAt: text('consumed_at'), ...timestamps,
}, (table) => [index('idx_remote_deliveries_node_status').on(table.nodeId, table.status, table.expiresAt)]);

export const providerWebhookDeliveries = pgTable('provider_webhook_deliveries', {
	id: text('id').primaryKey(), providerId: text('provider_id').notNull(), deliveryId: text('delivery_id').notNull(),
	eventType: text('event_type').notNull(), status: text('status').notNull(), bodyDigest: text('body_digest').notNull(),
	correlationId: text('correlation_id'), receivedAt: text('received_at').notNull(), processedAt: text('processed_at'),
}, (table) => [uniqueIndex('idx_provider_webhook_delivery').on(table.providerId, table.deliveryId)]);

export const providerConnectorAuthorizations = pgTable('provider_connector_authorizations', {
	id: text('id').primaryKey(), providerId: text('provider_id').notNull(), connectorKind: text('connector_kind').notNull(),
	teamId: text('team_id').notNull(), connectionId: text('connection_id').notNull(), actorUserId: text('actor_user_id').notNull(),
	stateHash: text('state_hash').notNull().unique(), phase: text('phase').notNull(), installationId: text('installation_id'),
	accountId: text('account_id'), accountLogin: text('account_login'), expiresAt: text('expires_at').notNull(),
	consumedAt: text('consumed_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_provider_connector_authorizations').on(table.providerId, table.connectorKind, table.expiresAt)]);

export const workflowConfigurationRecords = pgTable('workflow_configuration_records', {
	id: text('id').primaryKey(), projectId: text('project_id').notNull(), teamId: text('team_id').notNull(),
	workflowBindingId: text('workflow_binding_id').notNull(), repositoryBindingId: text('repository_binding_id').notNull(),
	kind: text('kind').notNull(), scope: text('scope').notNull(), environment: text('environment'), name: text('name').notNull(),
	status: text('status').notNull(), valueDigest: text('value_digest'), providerUpdatedAt: text('provider_updated_at'),
	lastObservedAt: text('last_observed_at'), updatedByUserId: text('updated_by_user_id'), ...timestamps,
}, (table) => [uniqueIndex('idx_workflow_configuration_target').on(table.repositoryBindingId, table.workflowBindingId,
	table.kind, table.scope, table.environment, table.name), index('idx_workflow_configuration_project').on(table.projectId, table.kind, table.status)]);

export const workflowConfigurationDeliveries = pgTable('workflow_configuration_deliveries', {
	id: text('id').primaryKey(), operationId: text('operation_id').notNull().unique(), recordId: text('record_id').notNull(),
	action: text('action').notNull(), payloadDigest: text('payload_digest'), keyId: text('key_id'),
	status: text('status').notNull(), expiresAt: text('expires_at').notNull(), consumedAt: text('consumed_at'), ...timestamps,
}, (table) => [index('idx_workflow_configuration_delivery_status').on(table.status, table.expiresAt)]);
