CREATE TABLE "capacity_workday_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"capacity_provider_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"purpose" text NOT NULL,
	"project_ids_json" text DEFAULT '[]' NOT NULL,
	"agent_selection_json" text DEFAULT '{}' NOT NULL,
	"cadence_seconds" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"max_active_assignments" integer NOT NULL,
	"available_credits" real NOT NULL,
	"planning_only" integer DEFAULT 1 NOT NULL,
	"publication_policy_json" text DEFAULT '{}' NOT NULL,
	"last_run_id" text,
	"next_run_at" text NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_capacity_workday_schedules_status" CHECK ("capacity_workday_schedules"."status" IN ('active','paused','completed','failed')),
	CONSTRAINT "chk_capacity_workday_schedules_cadence" CHECK ("capacity_workday_schedules"."cadence_seconds" >= 60),
	CONSTRAINT "chk_capacity_workday_schedules_duration" CHECK ("capacity_workday_schedules"."duration_seconds" >= 60),
	CONSTRAINT "chk_capacity_workday_schedules_concurrency" CHECK ("capacity_workday_schedules"."max_active_assignments" >= 1),
	CONSTRAINT "chk_capacity_workday_schedules_credits" CHECK ("capacity_workday_schedules"."available_credits" > 0),
	CONSTRAINT "chk_capacity_workday_schedules_planning" CHECK ("capacity_workday_schedules"."planning_only" IN (0,1)),
	CONSTRAINT "chk_capacity_workday_schedules_version" CHECK ("capacity_workday_schedules"."state_version" >= 1)
);
ALTER TABLE "capacity_workday_schedules" ADD CONSTRAINT "fk_capacity_workday_schedules_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "idx_capacity_workday_schedules_due" ON "capacity_workday_schedules" USING btree ("status","next_run_at");
CREATE INDEX "idx_capacity_workday_schedules_team" ON "capacity_workday_schedules" USING btree ("team_id","updated_at");
