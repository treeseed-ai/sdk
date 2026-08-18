import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxFileMutationResult,TreeDxPatchFileRequest } from "../../../types.ts";
export function patchFileMethod(this: TreeDxClient, input: TreeDxPatchFileRequest): Promise<TreeDxFileMutationResult> {
    const { workspaceId, path, ...body } = input;
    return this.request<TreeDxFileMutationResult>('PATCH', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files`, body, {
        query: { path },
        tokenRequired: true,
    });
}
