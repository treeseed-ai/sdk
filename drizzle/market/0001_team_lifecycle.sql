ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "archived_at" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "archived_by_user_id" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "purge_eligible_at" text;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "lifecycle_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "teams" ADD CONSTRAINT "chk_teams_status" CHECK ("status" IN ('active', 'archived'));
CREATE INDEX IF NOT EXISTS "idx_teams_status" ON "teams" ("status", "updated_at");
UPDATE "team_invites"
SET "status" = 'revoked'
WHERE "id" IN (
	SELECT "candidate"."id"
	FROM "team_invites" AS "candidate"
	INNER JOIN "team_invites" AS "keeper"
		ON "keeper"."team_id" = "candidate"."team_id"
		AND LOWER("keeper"."email") = LOWER("candidate"."email")
		AND "keeper"."id" > "candidate"."id"
	WHERE "candidate"."status" = 'pending'
		AND "keeper"."status" = 'pending'
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_team_invites_one_pending_recipient"
	ON "team_invites" ("team_id", LOWER("email"))
	WHERE "status" = 'pending';
