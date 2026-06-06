CREATE TABLE IF NOT EXISTS "treedx_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text,
	"registry_url" text,
	"public_read" integer DEFAULT 0 NOT NULL,
	"primary" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"image_ref" text,
	"railway_project_id" text,
	"railway_service_id" text,
	"railway_environment_id" text,
	"volume_mount_path" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "treedx_project_libraries" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"library_id" text NOT NULL,
	"repository_id" text,
	"content_path" text DEFAULT 'src/content' NOT NULL,
	"content_repository_url" text,
	"content_repository_default_branch" text,
	"content_repository_ref" text,
	"r2_bucket_name" text,
	"r2_manifest_key" text,
	"topology_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "treedx_mirrors" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"name" text NOT NULL,
	"direction" text DEFAULT 'bidirectional' NOT NULL,
	"target_kind" text NOT NULL,
	"target_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"instructions" text,
	"last_sync_at" text,
	"last_sync_status" text,
	"last_sync_metadata_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "treedx_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"instance_id" text,
	"project_id" text,
	"library_id" text,
	"scope" text NOT NULL,
	"target_team_id" text,
	"trust_grant_json" text DEFAULT '{}' NOT NULL,
	"public_read" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"revoked_at" text
);

CREATE TABLE IF NOT EXISTS "treedx_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"instance_id" text,
	"provider" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"image_ref" text,
	"volume_mount_path" text,
	"service_refs_json" text DEFAULT '{}' NOT NULL,
	"result_json" text DEFAULT '{}' NOT NULL,
	"error_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text
);

CREATE INDEX IF NOT EXISTS "idx_treedx_instances_team_status" ON "treedx_instances" USING btree ("team_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_treedx_instances_one_active_primary" ON "treedx_instances" USING btree ("team_id") WHERE "primary" = 1 AND "status" = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_treedx_project_libraries_project" ON "treedx_project_libraries" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "idx_treedx_project_libraries_instance" ON "treedx_project_libraries" USING btree ("instance_id");
CREATE INDEX IF NOT EXISTS "idx_treedx_mirrors_team_instance" ON "treedx_mirrors" USING btree ("team_id","instance_id");
CREATE INDEX IF NOT EXISTS "idx_treedx_shares_team_scope" ON "treedx_shares" USING btree ("team_id","scope","status");
CREATE INDEX IF NOT EXISTS "idx_treedx_deployments_team_instance" ON "treedx_deployments" USING btree ("team_id","instance_id","created_at");
