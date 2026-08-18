import { firstPayload,TreeDxClient } from '../../../support/client.ts';
import type { TreeDxSnapshot,TreeDxSnapshotBuildRequest } from '../../../types.ts';
export function buildSnapshotMethod(this: TreeDxClient, input: TreeDxSnapshotBuildRequest = {}): Promise<TreeDxSnapshot> {
    const { repoId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/snapshots/build`, body, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxSnapshot>(payload, ['snapshot']));
}
