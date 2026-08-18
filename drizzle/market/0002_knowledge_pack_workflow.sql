DROP TABLE IF EXISTS "knowledge_packs";

CREATE TABLE IF NOT EXISTS "book_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"book_ids_json" text DEFAULT '[]' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "knowledge_authoring_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"treedx_workspace_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"base_ref" text NOT NULL,
	"base_commit_sha" text NOT NULL,
	"branch_name" text NOT NULL,
	"allowed_paths_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "knowledge_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"submitted_by_user_id" text NOT NULL,
	"decided_by_user_id" text,
	"notes" text,
	"commit_sha" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "knowledge_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"review_id" text NOT NULL,
	"project_id" text NOT NULL,
	"commit_sha" text NOT NULL,
	"published_ref" text NOT NULL,
	"published_revision" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" text NOT NULL,
	"completed_at" text
);

CREATE TABLE IF NOT EXISTS "knowledge_pack_builds" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"collection_id" text,
	"requested_by_user_id" text NOT NULL,
	"book_ids_json" text DEFAULT '[]' NOT NULL,
	"source_closure" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"artifact_json" text DEFAULT '{}' NOT NULL,
	"error" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_book_collections_team_name" ON "book_collections" ("team_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_knowledge_workspaces_treedx" ON "knowledge_authoring_workspaces" ("treedx_workspace_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_workspaces_project_actor" ON "knowledge_authoring_workspaces" ("project_id", "actor_user_id", "status");
CREATE INDEX IF NOT EXISTS "idx_knowledge_reviews_workspace_status" ON "knowledge_reviews" ("workspace_id", "status");
CREATE INDEX IF NOT EXISTS "idx_knowledge_publications_project_status" ON "knowledge_publications" ("project_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_knowledge_publications_review" ON "knowledge_publications" ("review_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_pack_builds_team_status" ON "knowledge_pack_builds" ("team_id", "status");
