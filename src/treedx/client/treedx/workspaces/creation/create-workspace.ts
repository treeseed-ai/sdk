import { TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxCreateWorkspaceRequest,TreeDxWorkspace } from "../../../../types.ts";
export function createWorkspaceMethod(this: TreeDxClient, input: TreeDxCreateWorkspaceRequest): Promise<TreeDxWorkspace> {
    const { repoId, ...body } = input;
    return this.request<TreeDxWorkspace>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/workspaces`, body, { tokenRequired: true });
}
