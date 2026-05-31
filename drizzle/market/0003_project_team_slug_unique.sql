ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_slug_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_team_slug" ON "projects" USING btree ("team_id","slug");
DROP INDEX IF EXISTS "idx_catalog_items_kind_slug";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_catalog_items_team_kind_slug" ON "catalog_items" USING btree ("team_id","kind","slug");
