import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxBlobUploadAbortRequest,TreeDxBlobUploadSession } from "../../../../types.ts";
export function abortBlobUploadMethod(this: TreeDxClient, input: TreeDxBlobUploadAbortRequest): Promise<TreeDxBlobUploadSession> {
    return this.request<Record<string, unknown>>('DELETE', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/uploads/${encodeURIComponent(input.uploadId)}`, undefined, { tokenRequired: true }).then((payload) => firstPayload<TreeDxBlobUploadSession>(payload, ['upload']));
}
