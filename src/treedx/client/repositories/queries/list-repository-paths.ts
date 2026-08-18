import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxRepositoryPathsRequest,TreeDxRepositoryQueryResult } from "../../../types.ts";
export function listRepositoryPathsMethod(this: TreeDxClient, input: TreeDxRepositoryPathsRequest): Promise<TreeDxRepositoryQueryResult> {
    const { repoId, ...body } = input;
    return this.request<TreeDxRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/paths/list`, body, { tokenRequired: true });
}
