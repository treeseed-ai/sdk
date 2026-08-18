import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxRepositoryQueryRequest,TreeDxRepositoryQueryResult } from "../../../types.ts";
export function queryRepositoryMethod(this: TreeDxClient, input: TreeDxRepositoryQueryRequest): Promise<TreeDxRepositoryQueryResult> {
    const { repoId, ...body } = input;
    return this.request<TreeDxRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/query`, body, { tokenRequired: true });
}
