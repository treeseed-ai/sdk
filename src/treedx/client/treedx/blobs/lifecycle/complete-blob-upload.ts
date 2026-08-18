import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxBlobMutationResult,TreeDxBlobUploadCompleteRequest } from "../../../../types.ts";
export function completeBlobUploadMethod(this: TreeDxClient, input: TreeDxBlobUploadCompleteRequest): Promise<TreeDxBlobMutationResult> {
    const { workspaceId, uploadId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/blobs/uploads/${encodeURIComponent(uploadId)}/complete`, body, { tokenRequired: true }).then((payload) => firstPayload<TreeDxBlobMutationResult>(payload, ['result']));
}
