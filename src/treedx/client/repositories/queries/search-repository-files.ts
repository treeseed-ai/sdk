import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxRepositoryQueryResult,TreeDxRepositorySearchRequest } from "../../../types.ts";
export function searchRepositoryFilesMethod(this: TreeDxClient, input: TreeDxRepositorySearchRequest): Promise<TreeDxRepositoryQueryResult> {
    const { repoId, ...body } = input;
    return this.request<TreeDxRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/files/search`, body, { tokenRequired: true });
}
