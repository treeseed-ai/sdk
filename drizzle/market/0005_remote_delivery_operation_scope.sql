ALTER TABLE "remote_credential_deliveries"
	ADD COLUMN IF NOT EXISTS "operation_kind" text;

UPDATE "remote_credential_deliveries"
SET "operation_kind" = 'fetch', "status" = 'failed'
WHERE "operation_kind" IS NULL;

ALTER TABLE "remote_credential_deliveries"
	ALTER COLUMN "operation_kind" SET NOT NULL;
