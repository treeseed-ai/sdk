import { isRecord,TreeDxClient } from "../../../../../../support/client.ts";
import { TreeDxApiError } from "../../../../../../support/errors.ts";
export function throwApiErrorMethod(this: TreeDxClient, response: Response, payload: unknown): never {
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
