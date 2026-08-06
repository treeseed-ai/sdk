CREATE TABLE IF NOT EXISTS "agent_signals" (
  "id" text PRIMARY KEY NOT NULL,
  "contract_id" text NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_id" text NOT NULL,
  "team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "workday_run_id" text,
  "assignment_id" text REFERENCES "capacity_provider_assignments"("id") ON DELETE RESTRICT,
  "agent_id" text,
  "activity_type" text,
  "capacity_provider_id" text,
  "causation_id" text NOT NULL,
  "correlation_id" text NOT NULL,
  "origin" text NOT NULL CHECK ("origin" IN ('treedx-change','deterministic-handler','agent-tool')),
  "commit_sha" text,
  "immutable_ref" text,
  "digest" text,
  "changed_paths_json" text DEFAULT '[]' NOT NULL,
  "change_summary" text,
  "evidence_ref" text,
  "payload_json" text DEFAULT '{}' NOT NULL,
  "metadata_json" text DEFAULT '{}' NOT NULL,
  "created_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_signals_causation" ON "agent_signals" ("assignment_id","contract_id","subject_id","causation_id");
CREATE INDEX IF NOT EXISTS "idx_agent_signals_workday" ON "agent_signals" ("workday_run_id","contract_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_signals_subject" ON "agent_signals" ("team_id","project_id","subject_kind","subject_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_signals_commit" ON "agent_signals" ("project_id","commit_sha");

CREATE TABLE IF NOT EXISTS "workday_planning_sessions" (
  "id" text PRIMARY KEY NOT NULL, "team_id" text NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "workday_run_id" text NOT NULL REFERENCES "capacity_workday_runs"("id") ON DELETE RESTRICT,
  "graph_revision" text NOT NULL, "status" text DEFAULT 'scheduled' NOT NULL,
  "agenda_json" text DEFAULT '{}' NOT NULL, "objectives_json" text DEFAULT '[]' NOT NULL, "proposal_ids_json" text DEFAULT '[]' NOT NULL,
  "rounds" integer NOT NULL, "current_round" integer DEFAULT 0 NOT NULL, "allocated_seconds" integer NOT NULL, "reserved_seconds" integer DEFAULT 0 NOT NULL,
  "started_at" text, "deadline" text NOT NULL, "completed_at" text, "metadata_json" text DEFAULT '{}' NOT NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL,
  CHECK ("status" IN ('scheduled','running','completed','failed','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workday_planning_sessions_run" ON "workday_planning_sessions" ("workday_run_id");

CREATE TABLE IF NOT EXISTS "workday_planning_participants" (
  "id" text PRIMARY KEY NOT NULL, "session_id" text NOT NULL REFERENCES "workday_planning_sessions"("id") ON DELETE CASCADE,
  "agent_id" text NOT NULL, "project_agent_class_id" text NOT NULL, "status" text DEFAULT 'scheduled' NOT NULL,
  "requested_by_signal_id" text REFERENCES "agent_signals"("id") ON DELETE RESTRICT, "rationale" text, "metadata_json" text DEFAULT '{}' NOT NULL,
  "created_at" text NOT NULL, "updated_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workday_planning_participants_agent" ON "workday_planning_participants" ("session_id","agent_id");

CREATE TABLE IF NOT EXISTS "workday_planning_waves" (
  "id" text PRIMARY KEY NOT NULL, "session_id" text NOT NULL REFERENCES "workday_planning_sessions"("id") ON DELETE CASCADE,
  "round" integer NOT NULL, "wave" integer NOT NULL, "status" text DEFAULT 'scheduled' NOT NULL, "snapshot_ref" text NOT NULL, "snapshot_json" text DEFAULT '{}' NOT NULL,
  "assignment_ids_json" text DEFAULT '[]' NOT NULL, "started_at" text, "completed_at" text, "created_at" text NOT NULL, "updated_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workday_planning_waves_order" ON "workday_planning_waves" ("session_id","round","wave");

ALTER TABLE "capacity_workday_schedules" ADD COLUMN "available_seconds" integer;
ALTER TABLE "capacity_workday_schedules" ADD COLUMN "time_policy_json" text DEFAULT '{}' NOT NULL;
ALTER TABLE "capacity_workday_demands" ADD COLUMN "requested_seconds" integer;
ALTER TABLE "agent_capacity_plans" ADD COLUMN "expected_seconds" integer DEFAULT 0;
ALTER TABLE "agent_capacity_plans" ADD COLUMN "high_seconds" integer DEFAULT 0;
ALTER TABLE "capacity_reservations" ADD COLUMN "requested_seconds" integer;
ALTER TABLE "capacity_reservations" ADD COLUMN "reserved_seconds" integer;
ALTER TABLE "capacity_reservations" ADD COLUMN "active_seconds" integer DEFAULT 0 NOT NULL;
ALTER TABLE "capacity_reservations" ADD COLUMN "elapsed_seconds" integer DEFAULT 0 NOT NULL;
ALTER TABLE "capacity_reservations" ADD COLUMN "released_seconds" integer DEFAULT 0 NOT NULL;
ALTER TABLE "capacity_reservations" ADD COLUMN "overrun_seconds" integer DEFAULT 0 NOT NULL;
ALTER TABLE "capacity_usage_actuals" ADD COLUMN "active_seconds" integer DEFAULT 0 NOT NULL;
ALTER TABLE "capacity_usage_actuals" ADD COLUMN "elapsed_seconds" integer DEFAULT 0 NOT NULL;
ALTER TABLE "capacity_usage_actuals" ADD COLUMN "reasoning_tokens" integer;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN "active_seconds" integer DEFAULT 0 NOT NULL;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN "elapsed_seconds" integer DEFAULT 0 NOT NULL;
ALTER TABLE "governance_proposals" ADD COLUMN "proposal_types_json" text DEFAULT '[]' NOT NULL;
UPDATE "governance_proposals" SET "proposal_types_json" = '["' || replace("proposal_type", '"', '') || '"]' WHERE "proposal_types_json" = '[]';
ALTER TABLE "capacity_grants" ADD COLUMN "daily_agent_seconds_limit" integer;
ALTER TABLE "capacity_grants" ADD COLUMN "monthly_agent_seconds_limit" integer;
ALTER TABLE "capacity_reservations" ALTER COLUMN "reserved_credits" DROP NOT NULL;
ALTER TABLE "capacity_reservations" ALTER COLUMN "consumed_credits" DROP NOT NULL;
ALTER TABLE "capacity_usage_actuals" ALTER COLUMN "actual_credits" DROP NOT NULL;
ALTER TABLE "capacity_usage_actuals" ALTER COLUMN "credit_formula_version" DROP NOT NULL;
ALTER TABLE "capacity_usage_actuals" ALTER COLUMN "actual_credit_source" DROP NOT NULL;
ALTER TABLE "capacity_ledger_entries" ALTER COLUMN "credits" DROP NOT NULL;
