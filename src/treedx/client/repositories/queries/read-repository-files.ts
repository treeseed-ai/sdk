import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxRepositoryQueryResult,TreeDxRepositoryReadRequest } from "../../../types.ts";
export function readRepositoryFilesMethod(this: TreeDxClient, input: TreeDxRepositoryReadRequest): Promise<TreeDxRepositoryQueryResult> {
    const { repoId, ...body } = input;
    return this.request<TreeDxRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/files/read`, body, { tokenRequired: true });
}
