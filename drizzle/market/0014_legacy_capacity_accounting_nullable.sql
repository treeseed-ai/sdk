-- Credit columns remain only for historical inspection. New capacity records use
-- dimensional seconds, tokens, cost, and provider-native observations.
ALTER TABLE "capacity_workday_demands" ALTER COLUMN "requested_credits" DROP NOT NULL;
ALTER TABLE "capacity_workday_schedules" ALTER COLUMN "available_credits" DROP NOT NULL;
ALTER TABLE "agent_capacity_plans" ALTER COLUMN "expected_credits" DROP DEFAULT;
ALTER TABLE "agent_capacity_plans" ALTER COLUMN "expected_credits" DROP NOT NULL;
ALTER TABLE "agent_capacity_plans" ALTER COLUMN "high_credits" DROP DEFAULT;
ALTER TABLE "agent_capacity_plans" ALTER COLUMN "high_credits" DROP NOT NULL;
