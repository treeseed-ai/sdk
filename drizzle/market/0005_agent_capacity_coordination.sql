CREATE TABLE IF NOT EXISTS "capacity_allocation_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" text,
	"effective_until" text,
	"policy_json" text DEFAULT '{}' NOT NULL,
	"slices_json" text DEFAULT '[]' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_by_id" text,
	"activated_at" text,
	"superseded_by_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_capacity_allocation_sets_team_status" ON "capacity_allocation_sets" ("team_id","status","version");
CREATE INDEX IF NOT EXISTS "idx_capacity_allocation_sets_team_created" ON "capacity_allocation_sets" ("team_id","created_at");

CREATE TABLE IF NOT EXISTS "project_agent_classes" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"allowed_modes_json" text DEFAULT '[]' NOT NULL,
	"required_capabilities_json" text DEFAULT '[]' NOT NULL,
	"kernel_profile_json" text DEFAULT '{}' NOT NULL,
	"kernel_policy_json" text DEFAULT '{}' NOT NULL,
	"handler_refs_json" text DEFAULT '{}' NOT NULL,
	"output_contracts_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_agent_classes_project_slug" ON "project_agent_classes" ("project_id","slug");
CREATE INDEX IF NOT EXISTS "idx_project_agent_classes_team_project" ON "project_agent_classes" ("team_id","project_id","status");

CREATE TABLE IF NOT EXISTS "provider_availability_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"registration_id" text,
	"environment" text,
	"status" text DEFAULT 'open' NOT NULL,
	"checked_in_at" text NOT NULL,
	"available_from" text,
	"available_until" text,
	"execution_providers_json" text DEFAULT '[]' NOT NULL,
	"capabilities_json" text DEFAULT '[]' NOT NULL,
	"grants_json" text DEFAULT '[]' NOT NULL,
	"native_limits_json" text DEFAULT '{}' NOT NULL,
	"runner_pressure_json" text DEFAULT '{}' NOT NULL,
	"constraints_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"closed_at" text
);
CREATE INDEX IF NOT EXISTS "idx_provider_availability_sessions_provider_status" ON "provider_availability_sessions" ("capacity_provider_id","status","checked_in_at");
CREATE INDEX IF NOT EXISTS "idx_provider_availability_sessions_team_status" ON "provider_availability_sessions" ("team_id","status","checked_in_at");

CREATE TABLE IF NOT EXISTS "provider_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"provider_session_id" text,
	"execution_provider_id" text,
	"allocation_set_id" text,
	"project_agent_class_id" text NOT NULL,
	"reservation_id" text,
	"work_day_id" text,
	"task_id" text,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"lease_state" text DEFAULT 'unleased' NOT NULL,
	"lease_expires_at" text,
	"agent_id" text,
	"handler_id" text,
	"capacity_envelope_json" text DEFAULT '{}' NOT NULL,
	"decision_input_json" text DEFAULT '{}' NOT NULL,
	"workspace_context_json" text DEFAULT '{}' NOT NULL,
	"allowed_outputs_json" text DEFAULT '{}' NOT NULL,
	"explanation_json" text DEFAULT '{}' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"assigned_at" text,
	"claimed_at" text,
	"completed_at" text,
	"returned_at" text,
	"failed_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_provider_assignments_provider_status" ON "provider_assignments" ("capacity_provider_id","status","lease_expires_at");
CREATE INDEX IF NOT EXISTS "idx_provider_assignments_project_mode" ON "provider_assignments" ("project_id","mode","status");
CREATE INDEX IF NOT EXISTS "idx_provider_assignments_team_created" ON "provider_assignments" ("team_id","created_at");

CREATE TABLE IF NOT EXISTS "agent_mode_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"provider_assignment_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"execution_provider_id" text,
	"project_agent_class_id" text NOT NULL,
	"agent_id" text,
	"handler_id" text,
	"mode" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"selected_input_json" text DEFAULT '{}' NOT NULL,
	"capacity_envelope_json" text DEFAULT '{}' NOT NULL,
	"outputs_json" text DEFAULT '{}' NOT NULL,
	"trace_refs_json" text DEFAULT '{}' NOT NULL,
	"usage_actual_json" text DEFAULT '{}' NOT NULL,
	"validation_json" text DEFAULT '{}' NOT NULL,
	"fallback_reason" text,
	"started_at" text,
	"completed_at" text,
	"failed_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_agent_mode_runs_assignment" ON "agent_mode_runs" ("provider_assignment_id","status");
CREATE INDEX IF NOT EXISTS "idx_agent_mode_runs_project_mode" ON "agent_mode_runs" ("project_id","mode","created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_mode_runs_provider" ON "agent_mode_runs" ("capacity_provider_id","created_at");

ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "allocation_set_id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "project_agent_class_id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "assignment_id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "mode" text;
CREATE INDEX IF NOT EXISTS "idx_capacity_reservations_assignment" ON "capacity_reservations" ("assignment_id");

ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "assignment_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "mode_run_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "mode" text;
CREATE INDEX IF NOT EXISTS "idx_capacity_ledger_assignment" ON "capacity_ledger_entries" ("assignment_id","mode_run_id");

ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "assignment_id" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "mode_run_id" text;
ALTER TABLE "task_usage_actuals" ADD COLUMN IF NOT EXISTS "mode" text;
CREATE INDEX IF NOT EXISTS "idx_task_usage_actuals_assignment" ON "task_usage_actuals" ("assignment_id","mode_run_id");
