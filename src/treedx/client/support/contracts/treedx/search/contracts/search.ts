import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxSearchRequest,TreeDxSearchResult } from "../../../../../../types.ts";
export function searchMethod(this: TreeDxClient, input: TreeDxSearchRequest): Promise<TreeDxSearchResult> {
    const { workspaceId, ...body } = input;
    return this.request<TreeDxSearchResult>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/search`, body, { tokenRequired: true });
}
