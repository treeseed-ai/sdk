UPDATE "workflow_configuration_deliveries"
SET "status" = 'failed'
WHERE "status" = 'ready';

ALTER TABLE "workflow_configuration_deliveries"
DROP COLUMN IF EXISTS "payload";
