UPDATE "capacity_providers"
SET "credit_budget_mode" = 'derived'
WHERE "credit_budget_mode" IS NULL OR "credit_budget_mode" = '';
ALTER TABLE "capacity_providers" ALTER COLUMN "credit_budget_mode" SET DEFAULT 'derived';
