CREATE TABLE IF NOT EXISTS "auth_provider_states" (
	"id" text PRIMARY KEY NOT NULL, "provider" text NOT NULL, "state_hash" text NOT NULL UNIQUE,
	"code_verifier" text, "nonce" text, "callback_url" text NOT NULL, "return_to" text NOT NULL, "link_user_id" text,
	"purpose" text DEFAULT 'sign-in' NOT NULL, "action" text,
	"expires_at" text NOT NULL, "used_at" text, "created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_auth_provider_states_expiry" ON "auth_provider_states" ("expires_at", "used_at");

CREATE TABLE IF NOT EXISTS "auth_reauthentication_grants" (
	"id" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL, "session_id" text NOT NULL,
	"action" text NOT NULL, "expires_at" text NOT NULL, "consumed_at" text, "created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_auth_reauthentication_grants_session" ON "auth_reauthentication_grants" ("user_id", "session_id", "action", "expires_at");

CREATE TABLE IF NOT EXISTS "user_personal_themes" (
	"id" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL, "name" text NOT NULL,
	"normalized_name" text NOT NULL, "base_scheme" text NOT NULL, "palette_json" text NOT NULL,
	"compiler_version" integer DEFAULT 1 NOT NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_personal_themes_name" ON "user_personal_themes" ("user_id", "normalized_name");
CREATE INDEX IF NOT EXISTS "idx_user_personal_themes_user" ON "user_personal_themes" ("user_id", "updated_at");

CREATE TABLE IF NOT EXISTS "user_notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL, "email_cadence" text DEFAULT 'daily' NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL
);
CREATE TABLE IF NOT EXISTS "user_notification_global_content_types" (
	"user_id" text NOT NULL, "content_type" text NOT NULL,
	PRIMARY KEY ("user_id", "content_type")
);
CREATE TABLE IF NOT EXISTS "user_notification_project_overrides" (
	"user_id" text NOT NULL, "project_id" text NOT NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL,
	PRIMARY KEY ("user_id", "project_id")
);
CREATE TABLE IF NOT EXISTS "user_notification_project_content_types" (
	"user_id" text NOT NULL, "project_id" text NOT NULL, "content_type" text NOT NULL,
	PRIMARY KEY ("user_id", "project_id", "content_type")
);
CREATE TABLE IF NOT EXISTS "notification_events" (
	"id" text PRIMARY KEY NOT NULL, "event_type" text NOT NULL, "content_type" text NOT NULL,
	"project_id" text NOT NULL, "actor_id" text, "resource_id" text NOT NULL, "title" text NOT NULL,
	"summary" text, "target_url" text NOT NULL, "created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_notification_events_project" ON "notification_events" ("project_id", "created_at");
CREATE TABLE IF NOT EXISTS "user_notifications" (
	"id" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL, "event_id" text NOT NULL,
	"read_at" text, "created_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_notifications_event" ON "user_notifications" ("user_id", "event_id");
CREATE INDEX IF NOT EXISTS "idx_user_notifications_user" ON "user_notifications" ("user_id", "read_at", "created_at");
CREATE TABLE IF NOT EXISTS "notification_email_deliveries" (
	"id" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL, "event_id" text,
	"digest_key" text NOT NULL UNIQUE, "cadence" text NOT NULL, "status" text DEFAULT 'pending' NOT NULL,
	"due_at" text NOT NULL, "attempts" integer DEFAULT 0 NOT NULL, "sent_at" text, "last_error" text,
	"created_at" text NOT NULL, "updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_notification_email_deliveries_due" ON "notification_email_deliveries" ("status", "due_at");
