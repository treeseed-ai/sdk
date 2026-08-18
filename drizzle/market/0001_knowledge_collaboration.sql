ALTER TABLE "knowledge_pack_builds"
	ADD COLUMN IF NOT EXISTS "publication_revision" text;

UPDATE "knowledge_pack_builds"
	SET "publication_revision" = COALESCE("publication_revision", "source_closure", 'legacy-reentry-required')
	WHERE "publication_revision" IS NULL;

ALTER TABLE "knowledge_pack_builds"
	ALTER COLUMN "publication_revision" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "knowledge_review_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"path" text NOT NULL,
	"line_start" integer,
	"line_end" integer,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "knowledge_workspace_presence" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_seen_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_knowledge_review_comments_review_status"
	ON "knowledge_review_comments" ("review_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_knowledge_workspace_presence_actor"
	ON "knowledge_workspace_presence" ("workspace_id", "user_id");
