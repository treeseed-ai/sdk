import { TreeDxClient } from "../../../../../../support/client.ts";
export async function assertBinaryOkMethod(this: TreeDxClient, response: Response): Promise<void> {
    if (response.ok) {
        return;
    }
    let payload: unknown;
    try {
        payload = await response.json();
    }
    catch {
        payload = undefined;
    }
    this.throwApiError(response, payload);
}
