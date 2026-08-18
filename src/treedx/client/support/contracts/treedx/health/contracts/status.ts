import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxStatus,TreeDxWorkspaceRequest } from "../../../../../../types.ts";
export function statusMethod(this: TreeDxClient, input: TreeDxWorkspaceRequest): Promise<TreeDxStatus> {
    return this.request<TreeDxStatus>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/status`, undefined, { tokenRequired: true });
}
