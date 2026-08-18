import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxBlob,TreeDxBlobReadRequest } from "../../../../types.ts";
export function readBlobMethod(this: TreeDxClient, input: TreeDxBlobReadRequest): Promise<TreeDxBlob> {
    const { repoId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/blobs/read`, body, {
        tokenRequired: true,
    }).then((payload) => firstPayload<TreeDxBlob>(payload, ['blob']));
}
