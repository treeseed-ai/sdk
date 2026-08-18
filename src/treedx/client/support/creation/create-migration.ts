import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxMigration,TreeDxMigrationRequest,TreeDxRepositoryPlacement } from "../../../types.ts";
export function createMigrationMethod(this: TreeDxClient, input: TreeDxMigrationRequest): Promise<{
    migration: TreeDxMigration;
    placement?: TreeDxRepositoryPlacement;
}> {
    const { repoId, ...body } = input;
    return this.request<{
        migration: TreeDxMigration;
        placement?: TreeDxRepositoryPlacement;
    }>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/migrations`, body, { tokenRequired: true });
}
