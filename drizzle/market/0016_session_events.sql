CREATE TABLE "session_events" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"resource_id" text NOT NULL,
	"payload_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL
);

CREATE INDEX "idx_session_events_team_sequence" ON "session_events" USING btree ("team_id", "sequence");
CREATE INDEX "idx_session_events_expiry" ON "session_events" USING btree ("expires_at");
