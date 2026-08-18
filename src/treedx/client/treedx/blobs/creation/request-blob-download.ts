import { TreeDxClient } from "../../../../support/client.ts";
import { TreeDxApiError } from "../../../../support/errors.ts";
import type { TreeDxBlobDownload,TreeDxBlobDownloadRequest } from "../../../../types.ts";
export async function requestBlobDownloadMethod(this: TreeDxClient, input: TreeDxBlobDownloadRequest): Promise<TreeDxBlobDownload> {
    if (!this.token) {
        throw new TreeDxApiError('TreeDX bearer token is required.', {
            status: 401,
            code: 'missing_token',
        });
    }
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/download${this.query({
        path: input.path,
        allowProtected: input.allowProtected,
    })}`, {
        method: 'GET',
        headers: this.headers(false),
    });
    await this.assertBinaryOk(response);
    return {
        content: await response.arrayBuffer(),
        contentType: response.headers.get('content-type'),
        contentHash: response.headers.get('x-treedx-content-hash') ?? undefined,
        objectId: response.headers.get('x-treedx-object-id') ?? undefined,
        source: response.headers.get('x-treedx-source') as TreeDxBlobDownload['source'] | undefined,
    };
}
