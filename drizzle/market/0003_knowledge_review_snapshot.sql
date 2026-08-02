ALTER TABLE "knowledge_reviews"
	ADD COLUMN IF NOT EXISTS "changed_paths_json" text DEFAULT '[]' NOT NULL;
