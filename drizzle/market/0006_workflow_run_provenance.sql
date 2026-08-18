ALTER TABLE "workflow_operation_runs" ADD COLUMN IF NOT EXISTS "actor_type" text;
ALTER TABLE "workflow_operation_runs" ADD COLUMN IF NOT EXISTS "actor_id" text;
ALTER TABLE "workflow_operation_runs" ADD COLUMN IF NOT EXISTS "mode" text;
ALTER TABLE "workflow_operation_runs" ADD COLUMN IF NOT EXISTS "assignment_id" text;
ALTER TABLE "workflow_operation_runs" ADD COLUMN IF NOT EXISTS "handle_id" text;

UPDATE "workflow_operation_runs"
SET "actor_type" = COALESCE("actor_type", 'operator'),
	"actor_id" = COALESCE("actor_id", 'migration-unknown'),
	"mode" = COALESCE("mode", 'operator');

ALTER TABLE "workflow_operation_runs" ALTER COLUMN "actor_type" SET NOT NULL;
ALTER TABLE "workflow_operation_runs" ALTER COLUMN "actor_id" SET NOT NULL;
ALTER TABLE "workflow_operation_runs" ALTER COLUMN "mode" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_workflow_runs_assignment"
	ON "workflow_operation_runs" ("assignment_id", "status", "updated_at");
