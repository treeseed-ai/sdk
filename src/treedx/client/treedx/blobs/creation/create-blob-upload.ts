import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxBlobUploadCreateRequest,TreeDxBlobUploadSession } from "../../../../types.ts";
export function createBlobUploadMethod(this: TreeDxClient, input: TreeDxBlobUploadCreateRequest): Promise<TreeDxBlobUploadSession> {
    const { workspaceId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/blobs/uploads`, body, { tokenRequired: true }).then((payload) => firstPayload<TreeDxBlobUploadSession>(payload, ['upload']));
}
