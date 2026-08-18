import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxSnapshot } from "../../../../../../types.ts";
export function getSnapshotMethod(this: TreeDxClient, input: {
    repoId?: string;
    snapshotId: string;
}): Promise<TreeDxSnapshot> {
    return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/snapshots/${encodeURIComponent(input.snapshotId)}`, undefined, { tokenRequired: true }).then((payload) => firstPayload<TreeDxSnapshot>(payload, ['snapshot']));
}
