import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxStorageMigration } from "../../../../../../types.ts";
export function listStorageMigrationsMethod(this: TreeDxClient): Promise<{
    migrations: TreeDxStorageMigration[];
    manifest: Record<string, unknown>;
}> {
    return this.request<{
        migrations: TreeDxStorageMigration[];
        manifest: Record<string, unknown>;
    }>('GET', '/api/v1/admin/storage/migrations', undefined, { tokenRequired: true });
}
