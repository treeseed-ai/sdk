import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxFederatedGraphRequest,TreeDxFederatedGraphResult } from "../../../../types.ts";
export function federatedGraphMethod(this: TreeDxClient, input: TreeDxFederatedGraphRequest): Promise<TreeDxFederatedGraphResult> {
    return this.request<Record<string, unknown>>('POST', '/api/v1/graph/query', input, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxFederatedGraphResult>(payload, ['graph']));
}
