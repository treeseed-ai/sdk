import { TreeDxClient } from "../../../../support/client.ts";
export async function closeWorkspaceMethod(this: TreeDxClient, workspaceId: string): Promise<void> {
    await this.request<Record<string, unknown>>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/close`, {}, { tokenRequired: true });
}
