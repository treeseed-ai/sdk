import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxFileMutationResult,TreeDxWriteFileRequest } from "../../../types.ts";
export function writeFileMethod(this: TreeDxClient, input: TreeDxWriteFileRequest): Promise<TreeDxFileMutationResult> {
    const { workspaceId, path, ...body } = input;
    return this.request<TreeDxFileMutationResult>('PUT', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files`, body, {
        query: { path },
        tokenRequired: true,
    });
}
