import { TreeDxClient } from "../../../../../../support/client.ts";
import { TreeDxApiError } from "../../../../../../support/errors.ts";
export async function parseJsonResponseMethod(this: TreeDxClient, response: Response): Promise<unknown> {
    try {
        return await response.json();
    }
    catch (error) {
        throw new TreeDxApiError('TreeDX response was not valid JSON.', {
            status: response.status,
            code: 'invalid_response',
            payload: error,
        });
    }
}
