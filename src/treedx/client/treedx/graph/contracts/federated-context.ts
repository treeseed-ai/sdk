import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxFederatedContextRequest,TreeDxFederatedContextResult } from "../../../../types.ts";
export function federatedContextMethod(this: TreeDxClient, input: TreeDxFederatedContextRequest): Promise<TreeDxFederatedContextResult> {
    return this.request<Record<string, unknown>>('POST', '/api/v1/context/build', input, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxFederatedContextResult>(payload, ['context']));
}
