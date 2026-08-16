CREATE TABLE "agent_context_query_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	"test_id" text NOT NULL,
	"test_ref" text NOT NULL,
	"definition_kind" text NOT NULL,
	"definition_id" text NOT NULL,
	"definition_revision" integer NOT NULL,
	"definition_commit" text NOT NULL,
	"status" text NOT NULL,
	"checked_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"stats_json" text NOT NULL,
	"assertions_json" text NOT NULL,
	"result_digest" text NOT NULL,
	"result_json" text NOT NULL,
	CONSTRAINT "chk_agent_context_query_checks_kind" CHECK ("agent_context_query_checks"."definition_kind" IN ('query','query-set')),
	CONSTRAINT "chk_agent_context_query_checks_status" CHECK ("agent_context_query_checks"."status" IN ('passing','failing','stale'))
);

ALTER TABLE "agent_context_query_checks" ADD CONSTRAINT "fk_agent_context_query_checks_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_context_query_checks" ADD CONSTRAINT "fk_agent_context_query_checks_project" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "idx_agent_context_query_checks_idempotency" ON "agent_context_query_checks" USING btree ("team_id", "idempotency_key");
CREATE INDEX "idx_agent_context_query_checks_latest" ON "agent_context_query_checks" USING btree ("project_id", "definition_kind", "definition_id", "definition_revision", "checked_at");
