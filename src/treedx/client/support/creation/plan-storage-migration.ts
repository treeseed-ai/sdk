import { firstPayload,TreeDxClient } from "../../../support/client.ts";
import type { TreeDxStorageMigration,TreeDxStorageMigrationPlanRequest } from "../../../types.ts";
export function planStorageMigrationMethod(this: TreeDxClient, input: TreeDxStorageMigrationPlanRequest = {}): Promise<TreeDxStorageMigration> {
    return this.request<Record<string, unknown>>('POST', '/api/v1/admin/storage/migrations/plan', input, { tokenRequired: true }).then((payload) => firstPayload<TreeDxStorageMigration>(payload, ['migration']));
}
