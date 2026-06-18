CREATE TABLE IF NOT EXISTS "secret_metadata_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"secret_class" text NOT NULL,
	"custody_mode" text NOT NULL,
	"owner_kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"github_secret_target_json" text DEFAULT '{}' NOT NULL,
	"escrow_record_id" text,
	"api_decryptable" integer DEFAULT 0 NOT NULL,
	"plaintext_allowed" integer DEFAULT 0 NOT NULL,
	"fail_closed_code" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"tombstoned_at" text
);
CREATE INDEX IF NOT EXISTS "idx_secret_metadata_team_project" ON "secret_metadata_records" ("team_id","project_id","status");
CREATE INDEX IF NOT EXISTS "idx_secret_metadata_custody" ON "secret_metadata_records" ("custody_mode","status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_secret_metadata_team_name" ON "secret_metadata_records" ("team_id","project_id","name");

CREATE TABLE IF NOT EXISTS "client_encrypted_escrow_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"secret_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ciphertext_ref" text NOT NULL,
	"algorithm" text NOT NULL,
	"wrapping_key_id" text NOT NULL,
	"created_by_client_id" text,
	"expires_at" text,
	"migrated_to" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"tombstoned_at" text
);
CREATE INDEX IF NOT EXISTS "idx_client_encrypted_escrow_secret" ON "client_encrypted_escrow_records" ("secret_id","status");
CREATE INDEX IF NOT EXISTS "idx_client_encrypted_escrow_project" ON "client_encrypted_escrow_records" ("team_id","project_id","status");

CREATE TABLE IF NOT EXISTS "github_repository_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"repository" text NOT NULL,
	"installation_id" text,
	"account_login" text,
	"account_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"permissions_json" text DEFAULT '{}' NOT NULL,
	"environments_json" text DEFAULT '[]' NOT NULL,
	"drift_code" text,
	"observed_at" text,
	"revoked_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_github_repository_grants_project" ON "github_repository_grants" ("team_id","project_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_github_repository_grants_repository" ON "github_repository_grants" ("team_id","repository");

CREATE TABLE IF NOT EXISTS "workflow_operation_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"repository" text NOT NULL,
	"workflow_file" text NOT NULL,
	"secret_bearing" integer DEFAULT 0 NOT NULL,
	"trusted_execution_set_id" text NOT NULL,
	"dispatch_json" text DEFAULT '{}' NOT NULL,
	"inputs_json" text DEFAULT '[]' NOT NULL,
	"secret_classes_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"fail_closed_code" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"blocked_at" text
);
CREATE INDEX IF NOT EXISTS "idx_workflow_operation_records_project" ON "workflow_operation_records" ("team_id","project_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workflow_operation_records_operation" ON "workflow_operation_records" ("team_id","id");

CREATE TABLE IF NOT EXISTS "workflow_dispatch_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"workflow_operation_id" text NOT NULL,
	"platform_operation_id" text,
	"repository" text NOT NULL,
	"workflow_file" text NOT NULL,
	"ref" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"inputs_json" text DEFAULT '{}' NOT NULL,
	"result_json" text DEFAULT '{}' NOT NULL,
	"fail_closed_code" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"dispatched_at" text,
	"completed_at" text
);
CREATE INDEX IF NOT EXISTS "idx_workflow_dispatch_records_operation" ON "workflow_dispatch_records" ("workflow_operation_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_workflow_dispatch_records_platform" ON "workflow_dispatch_records" ("platform_operation_id");

CREATE TABLE IF NOT EXISTS "treedx_credential_issuance_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"assignment_id" text,
	"repository" text,
	"credential_provider" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"token_prefix" text,
	"token_hash" text,
	"scopes_json" text DEFAULT '[]' NOT NULL,
	"allowed_operations_json" text DEFAULT '[]' NOT NULL,
	"expires_at" text,
	"issued_at" text,
	"revoked_at" text,
	"fail_closed_code" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_treedx_credential_issuance_assignment" ON "treedx_credential_issuance_records" ("assignment_id","status","expires_at");
CREATE INDEX IF NOT EXISTS "idx_treedx_credential_issuance_project" ON "treedx_credential_issuance_records" ("project_id","status","updated_at");
