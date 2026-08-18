import { TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxGraphQueryRequest,TreeDxGraphQueryResult } from "../../../../types.ts";
export function queryGraphMethod(this: TreeDxClient, input: TreeDxGraphQueryRequest): Promise<TreeDxGraphQueryResult> {
    const { repoId, ...body } = input;
    return this.request<TreeDxGraphQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/query`, body, { tokenRequired: true });
}
