CREATE TABLE IF NOT EXISTS "project_contribution_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"generation" integer NOT NULL,
	"status" text NOT NULL,
	"repository_json" text NOT NULL,
	"grant_version" text NOT NULL,
	"grant_digest" text NOT NULL,
	"receipt_key_json" text NOT NULL,
	"authorized_by_principal_id" text NOT NULL,
	"authorized_by_display_name" text,
	"agent_ids_json" text NOT NULL,
	"capacity_provider_ids_json" text NOT NULL,
	"contribution_modes_json" text NOT NULL,
	"target_branches_json" text NOT NULL,
	"allowed_actions_json" text NOT NULL,
	"effective_at" text NOT NULL,
	"expires_at" text,
	"revoked_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_contribution_authorizations_generation" ON "project_contribution_authorizations" USING btree ("project_id","generation");
CREATE INDEX IF NOT EXISTS "idx_project_contribution_authorizations_status" ON "project_contribution_authorizations" USING btree ("project_id","status");

CREATE TABLE IF NOT EXISTS "project_contribution_attestation_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"authorization_id" text NOT NULL,
	"authorization_generation" integer NOT NULL,
	"project_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"checkpoint_id" text,
	"agent_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"repository_json" text NOT NULL,
	"base_branch" text NOT NULL,
	"base_sha" text NOT NULL,
	"head_branch" text NOT NULL,
	"head_sha" text NOT NULL,
	"payload_digest" text NOT NULL,
	"signing_key_id" text NOT NULL,
	"signature" text NOT NULL,
	"status" text NOT NULL,
	"issued_at" text NOT NULL,
	"created_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_contribution_attestation_receipts_assignment_head" ON "project_contribution_attestation_receipts" USING btree ("assignment_id","head_sha","authorization_generation");
CREATE INDEX IF NOT EXISTS "idx_project_contribution_attestation_receipts_project" ON "project_contribution_attestation_receipts" USING btree ("project_id","status");
