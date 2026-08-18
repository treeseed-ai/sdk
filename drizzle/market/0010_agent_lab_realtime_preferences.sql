ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "real_time_updates" integer DEFAULT 1 NOT NULL;
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "real_time_polling_interval_seconds" integer DEFAULT 5 NOT NULL;
