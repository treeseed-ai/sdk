CREATE TABLE IF NOT EXISTS "seed_team_membership_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"seed_name" text NOT NULL,
	"resource_key" text NOT NULL,
	"team_id" text NOT NULL,
	"normalized_email" text NOT NULL,
	"roles_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"membership_id" text,
	"binding_ids_json" text DEFAULT '[]' NOT NULL,
	"bound_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "fk_seed_team_membership_claim_team" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE,
	CONSTRAINT "fk_seed_team_membership_claim_membership" FOREIGN KEY ("membership_id") REFERENCES "team_memberships"("id") ON DELETE SET NULL,
	CONSTRAINT "chk_seed_team_membership_claim_status" CHECK ("status" IN ('pending', 'bound'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_seed_team_membership_claim_resource" ON "seed_team_membership_claims" ("seed_name", "resource_key");
CREATE INDEX IF NOT EXISTS "idx_seed_team_membership_claim_email" ON "seed_team_membership_claims" ("normalized_email", "status");
