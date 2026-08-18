import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxBlobMutationResult,TreeDxBlobWriteRequest } from "../../../../types.ts";
export function writeBlobMethod(this: TreeDxClient, input: TreeDxBlobWriteRequest): Promise<TreeDxBlobMutationResult> {
    const { workspaceId, path, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/blobs/write`, { path, ...body, encoding: body.encoding ?? 'base64' }, { tokenRequired: true }).then((payload) => firstPayload<TreeDxBlobMutationResult>(payload, ['result']));
}
