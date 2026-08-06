import { gzipSync } from 'node:zlib';
import { HttpMethod,isRecord,stripOk,TreeDxClient } from "../../../../../../support/client.ts";
import { TreeDxApiError } from "../../../../../../support/errors.ts";
export async function requestMethod<T>(this: TreeDxClient, method: HttpMethod, path: string, body?: unknown, options: {
    query?: Record<string, string | number | boolean | null | undefined>;
    tokenRequired?: boolean;
	gzipThresholdBytes?: number;
} = {}): Promise<T> {
    if (options.tokenRequired && !this.token) {
        throw new TreeDxApiError('TreeDX bearer token is required.', {
            status: 401,
            code: 'missing_token',
        });
    }
	const serialized = body === undefined ? undefined : JSON.stringify(body);
	const gzip = serialized !== undefined && options.gzipThresholdBytes !== undefined
		&& Buffer.byteLength(serialized, 'utf8') >= options.gzipThresholdBytes;
    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}${this.query(options.query ?? {})}`, {
        method,
		headers: { ...this.headers(body !== undefined), ...(gzip ? { 'content-encoding': 'gzip' } : {}) },
		body: serialized === undefined ? undefined : gzip ? gzipSync(serialized) : serialized,
    });
    let payload: unknown;
    try {
        payload = await response.json();
    }
    catch (error) {
        throw new TreeDxApiError('TreeDX response was not valid JSON.', {
            status: response.status,
            code: 'invalid_response',
            payload: error,
        });
    }
    if (!response.ok || (isRecord(payload) && payload.ok === false)) {
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
    return stripOk<T>(payload);
}
