import { firstPayload,isRecord,TreeDxClient } from "../../../../support/client.ts";
import { TreeDxApiError } from "../../../../support/errors.ts";
import type { TreeDxBlobMutationResult,TreeDxBlobUploadRequest } from "../../../../types.ts";
export async function requestBlobUploadMethod(this: TreeDxClient, input: TreeDxBlobUploadRequest): Promise<TreeDxBlobMutationResult> {
    if (!this.token) {
        throw new TreeDxApiError('TreeDX bearer token is required.', {
            status: 401,
            code: 'missing_token',
        });
    }
    const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': input.contentType ?? 'application/octet-stream',
    };
    if (this.token) {
        headers.authorization = `Bearer ${this.token}`;
    }
    if (input.expectedSha) {
        headers['x-treedx-expected-sha'] = input.expectedSha;
    }
    if (input.expectedContentHash) {
        headers['x-treedx-expected-content-hash'] = input.expectedContentHash;
    }
    if (input.allowProtected !== undefined) {
        headers['x-treedx-allow-protected'] = String(input.allowProtected);
    }
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/upload${this.query({
        path: input.path,
    })}`, {
        method: 'PUT',
        headers,
        body: input.content,
    });
    const payload = await this.parseJsonResponse(response);
    if (!response.ok || (isRecord(payload) && payload.ok === false)) {
        this.throwApiError(response, payload);
    }
    return firstPayload<TreeDxBlobMutationResult>(payload, ['result']);
}
