CREATE TABLE IF NOT EXISTS "github_app_installation_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text,
	"account_id" text,
	"account_type" text,
	"status" text DEFAULT 'active' NOT NULL,
	"permissions_json" text DEFAULT '{}' NOT NULL,
	"repository_selection" text,
	"drift_code" text,
	"observed_at" text,
	"revoked_at" text,
	"suspended_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_github_app_installations_team_status" ON "github_app_installation_records" ("team_id","status","updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_github_app_installations_team_installation" ON "github_app_installation_records" ("team_id","installation_id");

CREATE TABLE IF NOT EXISTS "github_app_token_issuance_records" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"assignment_id" text,
	"provider_id" text,
	"workday_id" text,
	"operation_id" text,
	"repository" text NOT NULL,
	"installation_id" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"token_prefix" text,
	"token_hash" text,
	"permissions_json" text DEFAULT '{}' NOT NULL,
	"allowed_operations_json" text DEFAULT '[]' NOT NULL,
	"expires_at" text,
	"issued_at" text,
	"revoked_at" text,
	"fail_closed_code" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_github_app_token_issuance_project" ON "github_app_token_issuance_records" ("team_id","project_id","status","updated_at");
CREATE INDEX IF NOT EXISTS "idx_github_app_token_issuance_operation" ON "github_app_token_issuance_records" ("operation_id","status","expires_at");
CREATE INDEX IF NOT EXISTS "idx_github_app_token_issuance_assignment" ON "github_app_token_issuance_records" ("assignment_id","status","expires_at");
