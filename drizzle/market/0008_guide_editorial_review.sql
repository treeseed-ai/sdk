ALTER TABLE "knowledge_reviews"
	ADD COLUMN IF NOT EXISTS "context_digest" text;

ALTER TABLE "knowledge_reviews"
	ADD COLUMN IF NOT EXISTS "requires_editorial_review" integer DEFAULT 0 NOT NULL;

ALTER TABLE "knowledge_reviews"
	ADD COLUMN IF NOT EXISTS "requires_graph_review" integer DEFAULT 0 NOT NULL;

ALTER TABLE "knowledge_reviews"
	ADD COLUMN IF NOT EXISTS "editorial_gate_satisfied" integer DEFAULT 0 NOT NULL;

ALTER TABLE "knowledge_reviews"
	ADD COLUMN IF NOT EXISTS "technical_review_json" text;

ALTER TABLE "knowledge_reviews"
	ADD COLUMN IF NOT EXISTS "audience_review_json" text;

ALTER TABLE "knowledge_reviews"
	ADD COLUMN IF NOT EXISTS "graph_review_json" text;

ALTER TABLE "knowledge_reviews"
	ADD COLUMN IF NOT EXISTS "required_reviewer_ids_json" text DEFAULT '{}' NOT NULL;

UPDATE "knowledge_reviews"
	SET "editorial_gate_satisfied" = 1
	WHERE "requires_editorial_review" = 0;
