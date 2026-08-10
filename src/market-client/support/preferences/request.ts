import { MarketClient,MarketClientError } from "../../../entrypoints/clients/market-client.ts";
import { REMOTE_CONTRACT_HEADER,REMOTE_CONTRACT_VERSION,} from "../../../entrypoints/clients/remote.ts";
export async function requestMethod<T>(this: MarketClient, path: string, options: {
    method?: string;
    body?: unknown;
    requireAuth?: boolean;
    headers?: Record<string, string>;
} = {}): Promise<T> {
    const headers: Record<string, string> = {
        accept: 'application/json',
        [REMOTE_CONTRACT_HEADER]: String(REMOTE_CONTRACT_VERSION),
        ...(options.headers ?? {}),
    };
    if (this.userAgent) {
        headers['user-agent'] = this.userAgent;
    }
    if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
    }
    if ((options.requireAuth ?? false) && this.accessToken) {
        headers.authorization = `Bearer ${this.accessToken}`;
    }
    const response = await this.fetchImpl(`${this.baseUrlForPath(path)}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const responsePayload = payload && typeof payload === 'object'
            ? payload as {
                error?: unknown;
                message?: unknown;
                details?: unknown;
            }
            : {};
        const payloadError = responsePayload.error;
        const baseError = typeof payloadError === 'string'
            ? String(payloadError)
            : payloadError && typeof payloadError === 'object' && typeof (payloadError as {
                message?: unknown;
            }).message === 'string'
                ? String((payloadError as {
                    message: string;
                }).message)
                : typeof responsePayload.message === 'string'
                    ? responsePayload.message
                    : `Market request failed with ${response.status}.`;
        const operation = responsePayload && 'details' in responsePayload
            && responsePayload.details && typeof responsePayload.details === 'object'
            && typeof (responsePayload.details as {
                operation?: unknown;
            }).operation === 'string'
            ? (responsePayload.details as {
                operation: string;
            }).operation
            : null;
        const error = operation ? `${baseError} (operation: ${operation})` : baseError;
        throw new MarketClientError(error, response.status, payload);
    }
    return payload as T;
}
