ALTER TABLE "workday_planning_participants" ADD COLUMN "node_id" text;
UPDATE "workday_planning_participants"
SET "node_id" = COALESCE("metadata_json"::jsonb ->> 'nodeId', "agent_id")
WHERE "node_id" IS NULL;
ALTER TABLE "workday_planning_participants" ALTER COLUMN "node_id" SET NOT NULL;
DROP INDEX IF EXISTS "idx_workday_planning_participants_agent";
CREATE UNIQUE INDEX "idx_workday_planning_participants_node" ON "workday_planning_participants" ("session_id","node_id");
CREATE INDEX "idx_workday_planning_participants_agent" ON "workday_planning_participants" ("session_id","agent_id");
