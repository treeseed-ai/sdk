import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxCommitRequest,TreeDxCommitResult } from "../../../../../../types.ts";
export function commitMethod(this: TreeDxClient, input: TreeDxCommitRequest): Promise<TreeDxCommitResult> {
    const { workspaceId, ...body } = input;
    return this.request<TreeDxCommitResult>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/commit`, body, { tokenRequired: true });
}
