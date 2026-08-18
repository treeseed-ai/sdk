import { TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxGraphRefreshRequest,TreeDxGraphRefreshResult } from "../../../../types.ts";
export function refreshGraphMethod(this: TreeDxClient, input: TreeDxGraphRefreshRequest = {}): Promise<TreeDxGraphRefreshResult> {
    const { repoId, ...body } = input;
    return this.request<TreeDxGraphRefreshResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/refresh`, body, { tokenRequired: true });
}
