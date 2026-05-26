CREATE TABLE IF NOT EXISTS "user_email_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_primary" integer DEFAULT 0 NOT NULL,
	"verification_requested_at" text,
	"verified_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "user_email_addresses_normalized_email_unique" UNIQUE("normalized_email")
);

CREATE INDEX IF NOT EXISTS "idx_user_email_addresses_user" ON "user_email_addresses" USING btree ("user_id","status","is_primary");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_email_addresses_normalized" ON "user_email_addresses" USING btree ("normalized_email");

INSERT INTO user_email_addresses (
	id, user_id, email, normalized_email, status, is_primary, verification_requested_at, verified_at, created_at, updated_at
)
SELECT 'email_' || md5(user_id || ':' || LOWER(email)), user_id, email, LOWER(email), 'verified', 1, created_at, COALESCE(updated_at, created_at), created_at, updated_at
  FROM market_auth_credentials
 WHERE email IS NOT NULL
   AND email != ''
   AND status = 'active'
ON CONFLICT (normalized_email) DO NOTHING;
