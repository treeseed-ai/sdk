import { isAbortError,TreeDxClient } from "../../../../../../support/client.ts";
import { TreeDxApiError } from "../../../../../../support/errors.ts";
export async function fetchWithTimeoutMethod(this: TreeDxClient, input: string, init: RequestInit): Promise<Response> {
    const timeoutMs = this.options.timeoutMs;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    if (timeoutMs && timeoutMs > 0) {
        controller = new AbortController();
        timeout = setTimeout(() => controller?.abort(), timeoutMs);
    }
    try {
        return await this.fetchImpl(input, {
            ...init,
            signal: controller?.signal ?? init.signal,
        });
    }
    catch (error: unknown) {
        if (isAbortError(error)) {
            throw new TreeDxApiError(`TreeDX request timed out after ${timeoutMs}ms.`, {
                status: 0,
                code: 'timeout',
                details: { timeoutMs },
                payload: error,
            });
        }
        throw new TreeDxApiError(error instanceof Error ? error.message : 'TreeDX network request failed.', {
            status: 0,
            code: 'network_error',
            payload: error,
        });
    }
    finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}
