CREATE TABLE IF NOT EXISTS "runtime_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"work_day_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"type" text NOT NULL,
	"idempotency_key" text NOT NULL UNIQUE,
	"payload_json" text NOT NULL,
	"state" text NOT NULL,
	"claimed_by" text,
	"claimed_at" text,
	"lease_expires_at" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_runtime_tasks_project_workday_state" ON "runtime_tasks" ("project_id","work_day_id","state","created_at");

CREATE TABLE IF NOT EXISTS "runtime_task_events" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"kind" text NOT NULL,
	"data_json" text NOT NULL,
	"actor" text,
	"created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_runtime_task_events_task_created" ON "runtime_task_events" ("task_id","created_at");

CREATE TABLE IF NOT EXISTS "runtime_task_outputs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"output_json" text NOT NULL,
	"output_ref" text,
	"summary_json" text,
	"actor" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_runtime_task_outputs_task_created" ON "runtime_task_outputs" ("task_id","created_at");
