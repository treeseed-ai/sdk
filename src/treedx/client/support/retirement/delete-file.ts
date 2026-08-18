import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxDeleteFileRequest,TreeDxFileMutationResult } from "../../../types.ts";
export function deleteFileMethod(this: TreeDxClient, input: TreeDxDeleteFileRequest): Promise<TreeDxFileMutationResult> {
    const { workspaceId, path, ...body } = input;
    return this.request<TreeDxFileMutationResult>('DELETE', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files`, body, {
        query: { path },
        tokenRequired: true,
    });
}
