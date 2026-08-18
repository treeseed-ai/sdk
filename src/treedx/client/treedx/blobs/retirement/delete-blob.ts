import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxBlobDeleteRequest,TreeDxBlobMutationResult } from "../../../../types.ts";
export function deleteBlobMethod(this: TreeDxClient, input: TreeDxBlobDeleteRequest): Promise<TreeDxBlobMutationResult> {
    const { workspaceId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/blobs/delete`, body, { tokenRequired: true }).then((payload) => firstPayload<TreeDxBlobMutationResult>(payload, ['result']));
}
