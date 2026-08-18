import { firstPayload,TreeDxClient } from "../../../support/client.ts";
import type { TreeDxStorageMigration,TreeDxStorageMigrationRollbackRequest } from "../../../types.ts";
export function rollbackStorageMigrationMethod(this: TreeDxClient, input: TreeDxStorageMigrationRollbackRequest): Promise<TreeDxStorageMigration> {
    return this.request<Record<string, unknown>>('POST', '/api/v1/admin/storage/migrations/rollback', input, { tokenRequired: true }).then((payload) => firstPayload<TreeDxStorageMigration>(payload, ['migration']));
}
