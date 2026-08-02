import { firstPayload,isRecord,TreeDxClient } from "../../../../support/client.ts";
import { TreeDxApiError } from "../../../../support/errors.ts";
import type { TreeDxBlobUploadPart,TreeDxBlobUploadPartRequest } from "../../../../types.ts";
export async function uploadBlobPartMethod(this: TreeDxClient, input: TreeDxBlobUploadPartRequest): Promise<TreeDxBlobUploadPart> {
    if (!this.token) {
        throw new TreeDxApiError('TreeDX bearer token is required.', {
            status: 401,
            code: 'missing_token',
        });
    }
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/uploads/${encodeURIComponent(input.uploadId)}/parts/${encodeURIComponent(input.partNumber)}`, {
        method: 'PUT',
        headers: {
            accept: 'application/json',
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/octet-stream',
        },
        body: input.content,
    });
    const payload = await this.parseJsonResponse(response);
    if (!response.ok || (isRecord(payload) && payload.ok === false)) {
        this.throwApiError(response, payload);
    }
    return firstPayload<TreeDxBlobUploadPart>(payload, ['part']);
}
