CREATE TABLE IF NOT EXISTS "agent_capacity_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scope_hash" text NOT NULL,
	"allocation_set_id" text,
	"work_day_id" text,
	"expected_credits" real DEFAULT 0 NOT NULL,
	"high_credits" real DEFAULT 0 NOT NULL,
	"work_units_json" text DEFAULT '[]' NOT NULL,
	"capability_needs_json" text DEFAULT '[]' NOT NULL,
	"environment_needs_json" text DEFAULT '[]' NOT NULL,
	"reserves_json" text DEFAULT '{}' NOT NULL,
	"blockers_json" text DEFAULT '[]' NOT NULL,
	"priority_rationale" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"accepted_at" text,
	"scheduled_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_agent_capacity_plans_decision" ON "agent_capacity_plans" ("decision_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_capacity_plans_project" ON "agent_capacity_plans" ("project_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_capacity_plans_workday" ON "agent_capacity_plans" ("work_day_id","status","created_at");

