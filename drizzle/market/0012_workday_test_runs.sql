CREATE TABLE IF NOT EXISTS "workday_test_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"capacity_provider_id" text,
	"scenario_id" text DEFAULT 'portfolio-local' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"environment" text DEFAULT 'local' NOT NULL,
	"requested_by_id" text,
	"parameters_json" text DEFAULT '{}' NOT NULL,
	"summary_json" text DEFAULT '{}' NOT NULL,
	"metrics_json" text DEFAULT '{}' NOT NULL,
	"expected_json" text DEFAULT '{}' NOT NULL,
	"actual_json" text DEFAULT '{}' NOT NULL,
	"report_refs_json" text DEFAULT '{}' NOT NULL,
	"error_json" text DEFAULT '{}' NOT NULL,
	"started_at" text,
	"completed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_workday_test_runs_team_status" ON "workday_test_runs" ("team_id","status","updated_at");
CREATE INDEX IF NOT EXISTS "idx_workday_test_runs_provider" ON "workday_test_runs" ("capacity_provider_id","updated_at");

CREATE TABLE IF NOT EXISTS "workday_test_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"workday_id" text,
	"assignment_id" text,
	"mode_run_id" text,
	"event_index" integer NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"title" text,
	"message" text,
	"parameters_json" text DEFAULT '{}' NOT NULL,
	"context_json" text DEFAULT '{}' NOT NULL,
	"refs_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_workday_test_events_run_index" ON "workday_test_events" ("run_id","event_index");
CREATE INDEX IF NOT EXISTS "idx_workday_test_events_project" ON "workday_test_events" ("project_id","created_at");
