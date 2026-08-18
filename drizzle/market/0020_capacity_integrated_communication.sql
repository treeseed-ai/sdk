-- Upgrade durable capacity state to the communication invocation and lane model.
-- Existing rows remain operational work; only newly admitted communication work may
-- select communication purpose or overflow.

ALTER TABLE "capacity_provider_lanes" ADD COLUMN IF NOT EXISTS "purpose" text NOT NULL DEFAULT 'operation';

ALTER TABLE "capacity_workday_runs" ADD COLUMN IF NOT EXISTS "execution_kind" text NOT NULL DEFAULT 'workday';
ALTER TABLE "capacity_workday_runs" ADD COLUMN IF NOT EXISTS "trigger_kind" text NOT NULL DEFAULT 'scheduled';
ALTER TABLE "capacity_workday_runs" ADD COLUMN IF NOT EXISTS "hidden" integer NOT NULL DEFAULT 0;

ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "lane_purpose" text;
ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "communication_overflow" integer NOT NULL DEFAULT 0;
ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "execution_kind" text NOT NULL DEFAULT 'workday';
ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "trigger_kind" text NOT NULL DEFAULT 'scheduled';
ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "invocation_id" text;
ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "parent_workday_id" text;
ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "parent_assignment_id" text;
ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "handoff_root_id" text;
ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "handoff_parent_id" text;
ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "handoff_depth" integer NOT NULL DEFAULT 0;
ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "source_message_refs_json" text NOT NULL DEFAULT '[]';
ALTER TABLE "capacity_provider_assignments" ADD COLUMN IF NOT EXISTS "operation_handoff_id" text;

ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "lane_purpose" text;
ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "communication_overflow" integer NOT NULL DEFAULT 0;
ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "execution_kind" text NOT NULL DEFAULT 'workday';
ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "trigger_kind" text NOT NULL DEFAULT 'scheduled';
ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "invocation_id" text;
ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "parent_workday_id" text;
ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "parent_assignment_id" text;
ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "handoff_root_id" text;
ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "handoff_parent_id" text;
ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "handoff_depth" integer NOT NULL DEFAULT 0;
ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "source_message_refs_json" text NOT NULL DEFAULT '[]';
ALTER TABLE "capacity_usage_actuals" ADD COLUMN IF NOT EXISTS "operation_handoff_id" text;

ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "lane_purpose" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "communication_overflow" integer NOT NULL DEFAULT 0;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "execution_kind" text NOT NULL DEFAULT 'workday';
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "trigger_kind" text NOT NULL DEFAULT 'scheduled';
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "invocation_id" text;
ALTER TABLE "capacity_reservations" ADD COLUMN IF NOT EXISTS "operation_handoff_id" text;

ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "execution_provider_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "lane_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "lane_purpose" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "communication_overflow" integer NOT NULL DEFAULT 0;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "execution_kind" text NOT NULL DEFAULT 'workday';
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "trigger_kind" text NOT NULL DEFAULT 'scheduled';
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "invocation_id" text;
ALTER TABLE "capacity_ledger_entries" ADD COLUMN IF NOT EXISTS "operation_handoff_id" text;

CREATE TABLE IF NOT EXISTS "agent_invocation_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text,
	"project_agent_class_id" text,
	"agent_id" text,
	"agent_revision" text,
	"mode" text DEFAULT 'planning' NOT NULL,
	"execution_kind" text DEFAULT 'workday' NOT NULL,
	"trigger_kind" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scope_hash" text NOT NULL,
	"prompt" text,
	"content_refs_json" text DEFAULT '[]' NOT NULL,
	"parent_workday_id" text,
	"parent_assignment_id" text,
	"handoff_root_id" text,
	"handoff_parent_id" text,
	"handoff_depth" integer DEFAULT 0 NOT NULL,
	"recipients_json" text DEFAULT '[]' NOT NULL,
	"blocking_state_json" text DEFAULT '{}' NOT NULL,
	"subject_digest" text,
	"priority_class" text DEFAULT 'operational' NOT NULL,
	"available_at" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"admitted_demand_id" text,
	"execution_id" text,
	"assignment_id" text,
	"final_message_ref" text,
	"response_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"requested_at" text NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" text,
	"stale_at" text,
	CONSTRAINT "chk_agent_invocations_mode" CHECK ("mode" IN ('planning','acting')),
	CONSTRAINT "chk_agent_invocations_execution_kind" CHECK ("execution_kind" IN ('workday','conversation','simulation','recovery')),
	CONSTRAINT "chk_agent_invocations_trigger_kind" CHECK ("trigger_kind" IN ('scheduled','manual','discussion','agent-handoff')),
	CONSTRAINT "chk_agent_invocations_priority" CHECK ("priority_class" IN ('human-interactive','workday-blocking-agent','agent-asynchronous','operational')),
	CONSTRAINT "chk_agent_invocations_status" CHECK ("status" IN ('queued','blocked','coalesced','admitted','running','suspended','completed','failed','cancelled','expired','stale')),
	CONSTRAINT "chk_agent_invocations_handoff_depth" CHECK ("handoff_depth" >= 0)
);

CREATE TABLE IF NOT EXISTS "agent_client_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"route" text NOT NULL,
	"capabilities_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"heartbeat_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_agent_client_sessions_status" CHECK ("status" IN ('active','closed','expired'))
);

CREATE TABLE IF NOT EXISTS "agent_client_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"assignment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload_json" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"expires_at" text NOT NULL,
	"completed_at" text,
	"result_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_agent_client_actions_kind" CHECK ("kind" IN ('navigate','reveal-resource','set-view-filter','populate-draft','present-confirmation')),
	CONSTRAINT "chk_agent_client_actions_status" CHECK ("status" IN ('pending','completed','rejected','expired','failed','unavailable'))
);

CREATE TABLE IF NOT EXISTS "agent_operation_handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"invocation_id" text,
	"discussion_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"status" text DEFAULT 'awaiting-approval' NOT NULL,
	"target" text NOT NULL,
	"expected_effect" text NOT NULL,
	"inputs_json" text DEFAULT '{}' NOT NULL,
	"source_message_refs_json" text DEFAULT '[]' NOT NULL,
	"required_authority_json" text DEFAULT '[]' NOT NULL,
	"proposal_id" text,
	"decision_id" text,
	"approval_request_id" text,
	"resulting_assignment_id" text,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_agent_operation_handoffs_status" CHECK ("status" IN ('awaiting-approval','approved','scheduled','running','completed','failed','cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_invocations_idempotency" ON "agent_invocation_requests" ("team_id","idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_agent_invocations_decision" ON "agent_invocation_requests" ("decision_id","status","requested_at");
CREATE INDEX IF NOT EXISTS "idx_agent_invocations_admission" ON "agent_invocation_requests" ("team_id","status","priority_class","available_at");
CREATE INDEX IF NOT EXISTS "idx_agent_invocations_discussion_agent" ON "agent_invocation_requests" ("project_id","agent_id","subject_digest","status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_client_actions_idempotency" ON "agent_client_actions" ("assignment_id","idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_agent_client_actions_session_status" ON "agent_client_actions" ("session_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_client_sessions_scope" ON "agent_client_sessions" ("user_id","team_id","project_id","status","expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_operation_handoffs_idempotency" ON "agent_operation_handoffs" ("assignment_id","idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_agent_operation_handoffs_discussion" ON "agent_operation_handoffs" ("project_id","discussion_id","status","created_at");

ALTER TABLE "agent_invocation_requests" ADD CONSTRAINT "fk_agent_invocations_team" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;
ALTER TABLE "agent_invocation_requests" ADD CONSTRAINT "fk_agent_invocations_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
ALTER TABLE "agent_invocation_requests" ADD CONSTRAINT "fk_agent_invocations_agent_class" FOREIGN KEY ("project_agent_class_id") REFERENCES "project_agent_classes"("id") ON DELETE RESTRICT;
ALTER TABLE "agent_client_sessions" ADD CONSTRAINT "fk_agent_client_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "agent_client_sessions" ADD CONSTRAINT "fk_agent_client_sessions_team" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;
ALTER TABLE "agent_client_sessions" ADD CONSTRAINT "fk_agent_client_sessions_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
ALTER TABLE "agent_client_actions" ADD CONSTRAINT "fk_agent_client_actions_session" FOREIGN KEY ("session_id") REFERENCES "agent_client_sessions"("id") ON DELETE SET NULL;
ALTER TABLE "agent_client_actions" ADD CONSTRAINT "fk_agent_client_actions_assignment" FOREIGN KEY ("assignment_id") REFERENCES "capacity_provider_assignments"("id") ON DELETE RESTRICT;
ALTER TABLE "agent_client_actions" ADD CONSTRAINT "fk_agent_client_actions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "agent_client_actions" ADD CONSTRAINT "fk_agent_client_actions_team" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;
ALTER TABLE "agent_client_actions" ADD CONSTRAINT "fk_agent_client_actions_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
ALTER TABLE "agent_operation_handoffs" ADD CONSTRAINT "fk_agent_operation_handoffs_assignment" FOREIGN KEY ("assignment_id") REFERENCES "capacity_provider_assignments"("id") ON DELETE RESTRICT;
ALTER TABLE "agent_operation_handoffs" ADD CONSTRAINT "fk_agent_operation_handoffs_team" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;
ALTER TABLE "agent_operation_handoffs" ADD CONSTRAINT "fk_agent_operation_handoffs_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
