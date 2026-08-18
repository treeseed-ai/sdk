CREATE TABLE IF NOT EXISTS "feedback_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"message" text NOT NULL,
	"submitter_user_id" text NOT NULL,
	"team_id" text,
	"project_id" text,
	"canonical_path" text NOT NULL,
	"route_pattern" text,
	"capability_id" text,
	"environment" text,
	"build_id" text,
	"revision" text,
	"context_json" text NOT NULL,
	"client_json" text NOT NULL,
	"allow_contact" integer DEFAULT 0 NOT NULL,
	"contact_email" text,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"resolved_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_feedback_status_created" ON "feedback_submissions" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_feedback_submitter_created" ON "feedback_submissions" ("submitter_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_feedback_team_created" ON "feedback_submissions" ("team_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_feedback_submitter_idempotency" ON "feedback_submissions" ("submitter_user_id", "idempotency_key");

CREATE TABLE IF NOT EXISTS "feedback_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"feedback_id" text NOT NULL,
	"storage_key" text NOT NULL UNIQUE,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"digest" text NOT NULL,
	"redaction_version" text,
	"masked_region_count" integer,
	"expires_at" text,
	"expired_at" text,
	"created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_feedback_attachments_feedback" ON "feedback_attachments" ("feedback_id", "created_at");

CREATE TABLE IF NOT EXISTS "feedback_status_events" (
	"id" text PRIMARY KEY NOT NULL,
	"feedback_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"actor_user_id" text NOT NULL,
	"created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_feedback_status_events_feedback" ON "feedback_status_events" ("feedback_id", "created_at");

CREATE TABLE IF NOT EXISTS "feedback_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"filters_json" text NOT NULL,
	"include_screenshots" integer DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"storage_key" text,
	"digest" text,
	"byte_size" integer,
	"source_closure" text,
	"error" text,
	"expires_at" text NOT NULL,
	"completed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_feedback_exports_status_expiry" ON "feedback_exports" ("status", "expires_at");

CREATE TABLE IF NOT EXISTS "feedback_export_items" (
	"export_id" text NOT NULL,
	"feedback_id" text NOT NULL,
	"created_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_feedback_export_items_pair" ON "feedback_export_items" ("export_id", "feedback_id");

INSERT INTO "feedback_submissions" (
	"id", "type", "status", "message", "submitter_user_id", "team_id", "project_id", "canonical_path",
	"route_pattern", "capability_id", "environment", "build_id", "revision", "context_json", "client_json",
	"allow_contact", "contact_email", "idempotency_key", "version", "resolved_at", "created_at", "updated_at"
)
SELECT
	CASE WHEN data_json::jsonb->>'id' IS NULL OR data_json::jsonb->>'id' = '' THEN id ELSE data_json::jsonb->>'id' END,
	data_json::jsonb->>'type', 'new', data_json::jsonb->>'message', actor_id,
	NULL, NULL, '/', NULL, NULL, NULL, NULL, NULL, '{}', '{}',
	CASE WHEN data_json::jsonb->>'contactEmail' IS NULL OR data_json::jsonb->>'contactEmail' = '' THEN 0 ELSE 1 END,
	CASE WHEN data_json::jsonb->>'contactEmail' = '' THEN NULL ELSE data_json::jsonb->>'contactEmail' END,
	'legacy-audit-' || id, 1, NULL, created_at, created_at
FROM "audit_events"
WHERE event_type = 'feedback.submitted'
	AND actor_id IS NOT NULL
	AND data_json IS NOT NULL
	AND data_json::jsonb->>'type' IN ('bug', 'feature_suggestion', 'question', 'content_issue', 'ux_issue')
	AND data_json::jsonb->>'message' IS NOT NULL
	AND data_json::jsonb->>'message' <> ''
ON CONFLICT DO NOTHING;

UPDATE "audit_events"
SET data_json = '{"feedbackId":"' || CASE WHEN data_json::jsonb->>'id' IS NULL OR data_json::jsonb->>'id' = '' THEN id ELSE data_json::jsonb->>'id' END
	|| '","type":"' || COALESCE(data_json::jsonb->>'type', 'unknown') || '","legacy":true}'
WHERE event_type = 'feedback.submitted' AND data_json IS NOT NULL;

DELETE FROM "team_inbox_items" WHERE kind = 'feedback' OR id LIKE 'feedback:%';
