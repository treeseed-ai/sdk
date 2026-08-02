import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxMigration } from "../../../../../../types.ts";
export function getMigrationMethod(this: TreeDxClient, input: {
    repoId?: string;
    migrationId: string;
}): Promise<TreeDxMigration> {
    return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/migrations/${encodeURIComponent(input.migrationId)}`, undefined, { tokenRequired: true }).then((payload) => firstPayload<TreeDxMigration>(payload, ['migration']));
}
