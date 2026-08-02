import { isRecord,parseFilename,TreeDxClient } from "../../../support/client.ts";
import { TreeDxApiError } from "../../../support/errors.ts";
import type { TreeDxArtifactDownload } from "../../../types.ts";
export async function requestBinaryMethod(this: TreeDxClient, path: string, body: unknown, options: {
    query?: Record<string, string | number | boolean | null | undefined>;
    tokenRequired?: boolean;
} = {}): Promise<TreeDxArtifactDownload> {
    if (options.tokenRequired && !this.token) {
        throw new TreeDxApiError('TreeDX bearer token is required.', {
            status: 401,
            code: 'missing_token',
        });
    }
    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}${this.query({ ...options.query, download: true })}`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        let payload: unknown;
        try {
            payload = await response.json();
        }
        catch {
            payload = undefined;
        }
        const errorBody = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
        throw new TreeDxApiError(typeof errorBody.message === 'string'
            ? errorBody.message
            : `TreeDX request failed with status ${response.status}.`, {
            status: response.status,
            code: typeof errorBody.code === 'string' ? errorBody.code : 'treedx_api_error',
            details: isRecord(errorBody.details) ? errorBody.details : {},
            payload,
        });
    }
    const content = await response.arrayBuffer();
    const contentDisposition = response.headers.get('content-disposition');
    return {
        content,
        contentType: response.headers.get('content-type'),
        filename: parseFilename(contentDisposition),
        checksum: response.headers.get('x-treedx-artifact-checksum') ?? undefined,
        snapshotId: response.headers.get('x-treedx-snapshot-id') ?? undefined,
    };
}
