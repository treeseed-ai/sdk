import { TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxMirrorHealthRequest,TreeDxMirrorHealthResult } from "../../../../types.ts";
export function checkMirrorHealthMethod(this: TreeDxClient, input: TreeDxMirrorHealthRequest): Promise<TreeDxMirrorHealthResult> {
    const { repoId, mirrorId } = input;
    return this.request<TreeDxMirrorHealthResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/mirrors/${encodeURIComponent(mirrorId)}/health`, {}, { tokenRequired: true });
}
