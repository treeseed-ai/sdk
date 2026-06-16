ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "lease_token" text;
ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "lease_renewed_at" text;
ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "runner_id" text;
ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "lifecycle_reason" text;
ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "lifecycle_code" text;
ALTER TABLE "provider_assignments" ADD COLUMN IF NOT EXISTS "lifecycle_output_json" text DEFAULT '{}' NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_provider_assignments_lease" ON "provider_assignments" ("capacity_provider_id","lease_state","lease_expires_at");
CREATE INDEX IF NOT EXISTS "idx_provider_assignments_runner" ON "provider_assignments" ("runner_id","lease_state");
