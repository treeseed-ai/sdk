CREATE TABLE IF NOT EXISTS "decision_planning_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"human_approval_state" text,
	"execution_readiness" text DEFAULT 'draft' NOT NULL,
	"planning_inputs_status" text DEFAULT 'requested' NOT NULL,
	"scope_hash" text NOT NULL,
	"stale_reason" text,
	"ready_at" text,
	"stale_at" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_decision_planning_statuses_decision" ON "decision_planning_statuses" ("decision_id");
CREATE INDEX IF NOT EXISTS "idx_decision_planning_statuses_project" ON "decision_planning_statuses" ("project_id","execution_readiness","updated_at");

CREATE TABLE IF NOT EXISTS "planning_input_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"project_agent_class_id" text,
	"mode" text DEFAULT 'planning' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"scope_hash" text NOT NULL,
	"prompt" text,
	"response_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"requested_at" text NOT NULL,
	"completed_at" text,
	"stale_at" text
);
CREATE INDEX IF NOT EXISTS "idx_planning_input_requests_decision" ON "planning_input_requests" ("decision_id","status","requested_at");
CREATE INDEX IF NOT EXISTS "idx_planning_input_requests_project" ON "planning_input_requests" ("project_id","status","requested_at");

CREATE TABLE IF NOT EXISTS "decision_execution_inputs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"project_agent_class_id" text NOT NULL,
	"mode" text DEFAULT 'acting' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"scope_hash" text NOT NULL,
	"input_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"accepted_at" text,
	"revision_requested_at" text,
	"stale_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_decision_execution_inputs_decision" ON "decision_execution_inputs" ("decision_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_decision_execution_inputs_project" ON "decision_execution_inputs" ("project_id","status","mode","created_at");

CREATE TABLE IF NOT EXISTS "workday_capacity_envelopes" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"allocation_set_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"started_at" text,
	"paused_at" text,
	"completed_at" text,
	"envelope_json" text DEFAULT '{}' NOT NULL,
	"mode_splits_json" text DEFAULT '{}' NOT NULL,
	"caps_json" text DEFAULT '{}' NOT NULL,
	"reserves_json" text DEFAULT '{}' NOT NULL,
	"borrowing_rules_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_workday_capacity_envelopes_project_status" ON "workday_capacity_envelopes" ("project_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_workday_capacity_envelopes_team_status" ON "workday_capacity_envelopes" ("team_id","status","created_at");

CREATE TABLE IF NOT EXISTS "provider_assignment_explanations" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text,
	"eligible" integer DEFAULT 1 NOT NULL,
	"reasons_json" text DEFAULT '[]' NOT NULL,
	"gates_json" text DEFAULT '{}' NOT NULL,
	"allocation_policy_version" text,
	"grant_scope" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_provider_assignment_explanations_assignment" ON "provider_assignment_explanations" ("assignment_id");
CREATE INDEX IF NOT EXISTS "idx_provider_assignment_explanations_team" ON "provider_assignment_explanations" ("team_id","created_at");

CREATE TABLE IF NOT EXISTS "agent_fallback_outputs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"assignment_id" text,
	"mode" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"output_json" text DEFAULT '{}' NOT NULL,
	"provenance_json" text DEFAULT '{}' NOT NULL,
	"quota_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_agent_fallback_outputs_project" ON "agent_fallback_outputs" ("project_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_fallback_outputs_assignment" ON "agent_fallback_outputs" ("assignment_id");

CREATE TABLE IF NOT EXISTS "treedx_project_proxy_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"assignment_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"handle_json" text DEFAULT '{}' NOT NULL,
	"result_status" text DEFAULT 'observed' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_treedx_project_proxy_audit_project" ON "treedx_project_proxy_audit" ("project_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_treedx_project_proxy_audit_assignment" ON "treedx_project_proxy_audit" ("assignment_id","created_at");

CREATE TABLE IF NOT EXISTS "capacity_settlement_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"work_day_id" text,
	"allocation_set_id" text,
	"policy_version" text,
	"reserved_credits" real DEFAULT 0 NOT NULL,
	"consumed_credits" real DEFAULT 0 NOT NULL,
	"released_credits" real DEFAULT 0 NOT NULL,
	"refunded_credits" real DEFAULT 0 NOT NULL,
	"native_usage_json" text DEFAULT '{}' NOT NULL,
	"provider_confidence" text DEFAULT 'medium' NOT NULL,
	"warnings_json" text DEFAULT '[]' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_capacity_settlement_summaries_scope" ON "capacity_settlement_summaries" ("team_id","project_id","work_day_id","created_at");

ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "synthesized_from" text;
ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "synthesis_key" text;
ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "decision_id" text;
ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "proposal_id" text;
ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "fallback_output_id" text;
ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "treedx_proxy_handle_json" text DEFAULT '{}' NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_provider_assignments_synthesis_key" ON "provider_assignments" ("team_id","synthesis_key");
CREATE INDEX IF NOT EXISTS "idx_provider_assignments_decision" ON "provider_assignments" ("decision_id","status");
