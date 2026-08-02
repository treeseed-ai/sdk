CREATE TABLE IF NOT EXISTS "project_remote_repository_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL UNIQUE,
	"team_id" text NOT NULL,
	"service_connection_id" text NOT NULL,
	"capability_binding_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_repository_id" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"clone_url" text NOT NULL,
	"default_ref" text NOT NULL,
	"publication_ref" text NOT NULL,
	"authority_id" text NOT NULL,
	"expected_head" text,
	"observed_head" text,
	"grant_status" text DEFAULT 'missing' NOT NULL,
	"drift" text DEFAULT 'unknown' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_workflow_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"workflow_binding_id" text NOT NULL,
	"repository_binding_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"ref_policy_json" text DEFAULT '[]' NOT NULL,
	"allowed_inputs_json" text DEFAULT '{}' NOT NULL,
	"required_secrets_json" text DEFAULT '[]' NOT NULL,
	"required_variables_json" text DEFAULT '[]' NOT NULL,
	"actor_policy_json" text DEFAULT '[]' NOT NULL,
	"mode_policy_json" text DEFAULT '[]' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "provider_connector_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"connector_kind" text NOT NULL,
	"team_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"state_hash" text NOT NULL UNIQUE,
	"phase" text NOT NULL,
	"installation_id" text,
	"account_id" text,
	"account_login" text,
	"expires_at" text NOT NULL,
	"consumed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "provider_credential_authorities" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"credential_profile_id" text NOT NULL,
	"scheme" text NOT NULL,
	"reference" text NOT NULL,
	"capabilities_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'reauthorization-required' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "provider_webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"body_digest" text NOT NULL,
	"correlation_id" text,
	"received_at" text NOT NULL,
	"processed_at" text
);

CREATE TABLE IF NOT EXISTS "remote_credential_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL UNIQUE,
	"operation_id" text NOT NULL,
	"node_id" text NOT NULL,
	"operation_kind" text NOT NULL,
	"allowed_host" text NOT NULL,
	"refspec_digest" text NOT NULL,
	"delivery_mode" text NOT NULL,
	"ciphertext" text,
	"algorithm" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"expires_at" text NOT NULL,
	"consumed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "remote_git_operation_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"repository_binding_id" text NOT NULL,
	"treedx_node_id" text NOT NULL,
	"source_ref" text NOT NULL,
	"destination_ref" text NOT NULL,
	"reviewed_commit" text NOT NULL,
	"expected_remote_head" text NOT NULL,
	"credential_authority_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" text NOT NULL,
	"idempotency_key" text NOT NULL UNIQUE,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "workflow_configuration_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL UNIQUE,
	"record_id" text NOT NULL,
	"action" text NOT NULL,
	"payload_digest" text,
	"key_id" text,
	"status" text NOT NULL,
	"expires_at" text NOT NULL,
	"consumed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "workflow_configuration_records" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"workflow_binding_id" text NOT NULL,
	"repository_binding_id" text NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"environment" text,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"value_digest" text,
	"provider_updated_at" text,
	"last_observed_at" text,
	"updated_by_user_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "workflow_operation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"mode" text NOT NULL,
	"assignment_id" text,
	"handle_id" text,
	"provider_id" text NOT NULL,
	"provider_run_id" text,
	"provider_run_url" text,
	"source_sha" text NOT NULL,
	"ref" text NOT NULL,
	"correlation_id" text NOT NULL UNIQUE,
	"status" text DEFAULT 'authorizing' NOT NULL,
	"artifacts_json" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_remote_repository_team_provider" ON "project_remote_repository_bindings" ("team_id", "provider_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_remote_repository_provider_id" ON "project_remote_repository_bindings" ("provider_id", "provider_repository_id");
CREATE INDEX IF NOT EXISTS "idx_workflow_operations_project" ON "project_workflow_operations" ("project_id", "workflow_id");
CREATE INDEX IF NOT EXISTS "idx_provider_connector_authorizations" ON "provider_connector_authorizations" ("provider_id", "connector_kind", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_provider_authorities_team_status" ON "provider_credential_authorities" ("team_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_provider_authorities_connection_profile" ON "provider_credential_authorities" ("connection_id", "credential_profile_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_provider_webhook_delivery" ON "provider_webhook_deliveries" ("provider_id", "delivery_id");
CREATE INDEX IF NOT EXISTS "idx_remote_deliveries_node_status" ON "remote_credential_deliveries" ("node_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_remote_git_grants_status" ON "remote_git_operation_grants" ("status", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_workflow_configuration_delivery_status" ON "workflow_configuration_deliveries" ("status", "expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workflow_configuration_target" ON "workflow_configuration_records" ("repository_binding_id", "workflow_binding_id", "kind", "scope", "environment", "name");
CREATE INDEX IF NOT EXISTS "idx_workflow_configuration_project" ON "workflow_configuration_records" ("project_id", "kind", "status");
CREATE INDEX IF NOT EXISTS "idx_workflow_runs_operation_status" ON "workflow_operation_runs" ("operation_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "idx_workflow_runs_assignment" ON "workflow_operation_runs" ("assignment_id", "status", "updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workflow_runs_provider_id" ON "workflow_operation_runs" ("provider_id", "provider_run_id");
