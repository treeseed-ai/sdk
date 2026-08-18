import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxExecRequest,TreeDxExecResult } from "../../../../../../types.ts";
export function execMethod(this: TreeDxClient, input: TreeDxExecRequest): Promise<TreeDxExecResult> {
    const { workspaceId, ...body } = input;
    return this.request<TreeDxExecResult>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/exec`, body, { tokenRequired: true });
}
