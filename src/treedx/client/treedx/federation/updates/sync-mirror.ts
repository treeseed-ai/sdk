import { TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxMirrorSyncRequest,TreeDxMirrorSyncResult } from "../../../../types.ts";
export function syncMirrorMethod(this: TreeDxClient, input: TreeDxMirrorSyncRequest): Promise<TreeDxMirrorSyncResult> {
    const { repoId, mirrorId, ...body } = input;
    return this.request<TreeDxMirrorSyncResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/mirrors/${encodeURIComponent(mirrorId)}/sync`, body, { tokenRequired: true });
}
