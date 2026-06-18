CREATE TABLE IF NOT EXISTS "treedx_proxy_handles" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"assignment_id" text,
	"repository_id" text,
	"workspace_id" text,
	"status" text DEFAULT 'issued' NOT NULL,
	"scopes_json" text DEFAULT '[]' NOT NULL,
	"allowed_operations_json" text DEFAULT '[]' NOT NULL,
	"allowed_paths_json" text DEFAULT '[]' NOT NULL,
	"token_hash" text,
	"expires_at" text,
	"issued_at" text NOT NULL,
	"revoked_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_treedx_proxy_handles_assignment" ON "treedx_proxy_handles" ("assignment_id","status","expires_at");
CREATE INDEX IF NOT EXISTS "idx_treedx_proxy_handles_project" ON "treedx_proxy_handles" ("project_id","status","updated_at");

ALTER TABLE "treedx_project_proxy_audit" ADD COLUMN IF NOT EXISTS "reason_code" text;
ALTER TABLE "treedx_project_proxy_audit" ADD COLUMN IF NOT EXISTS "reason" text;
CREATE INDEX IF NOT EXISTS "idx_treedx_project_proxy_audit_result" ON "treedx_project_proxy_audit" ("project_id","result_status","created_at");

ALTER TABLE "agent_capacity_plans" ADD COLUMN IF NOT EXISTS "review_json" text DEFAULT '{}' NOT NULL;
ALTER TABLE "agent_capacity_plans" ADD COLUMN IF NOT EXISTS "superseded_at" text;

