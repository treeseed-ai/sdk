import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxDiff,TreeDxWorkspaceRequest } from "../../../../../../types.ts";
export function diffMethod(this: TreeDxClient, input: TreeDxWorkspaceRequest): Promise<TreeDxDiff> {
    return this.request<TreeDxDiff>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/diff`, undefined, { tokenRequired: true });
}
