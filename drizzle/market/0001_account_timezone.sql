ALTER TABLE "user_preferences"
	ADD COLUMN IF NOT EXISTS "time_zone" text DEFAULT 'UTC' NOT NULL;

INSERT INTO "user_preferences" ("user_id", "color_scheme", "theme_mode", "time_zone", "created_at", "updated_at")
SELECT "user_id", 'fern', 'system', "time_zone", "created_at", "updated_at"
FROM "user_notification_preferences"
ON CONFLICT ("user_id") DO UPDATE
SET "time_zone" = excluded."time_zone",
	"updated_at" = excluded."updated_at";

ALTER TABLE "user_notification_preferences"
	DROP COLUMN IF EXISTS "time_zone";
