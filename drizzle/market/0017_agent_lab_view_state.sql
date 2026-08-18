CREATE TABLE "agent_lab_view_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"namespace" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"pinned" integer DEFAULT 0 NOT NULL,
	"hidden" integer DEFAULT 0 NOT NULL,
	"resolved" integer DEFAULT 0 NOT NULL,
	"layout_json" text DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE UNIQUE INDEX "idx_agent_lab_view_state_owner_entity" ON "agent_lab_view_state" USING btree ("user_id", "team_id", "namespace", "entity_kind", "entity_id");
CREATE INDEX "idx_agent_lab_view_state_owner_namespace" ON "agent_lab_view_state" USING btree ("user_id", "team_id", "namespace", "updated_at");
