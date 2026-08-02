import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxFetchRemoteRequest,TreeDxFetchRemoteResult } from "../../../../../../types.ts";
export function fetchRemoteMethod(this: TreeDxClient, input: TreeDxFetchRemoteRequest): Promise<TreeDxFetchRemoteResult> {
    const { repoId, ...body } = input;
    return this.request<TreeDxFetchRemoteResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/sync`, body, { tokenRequired: true });
}
