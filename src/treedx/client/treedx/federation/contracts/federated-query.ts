import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxFederatedQueryRequest,TreeDxFederatedQueryResult } from "../../../../types.ts";
export function federatedQueryMethod(this: TreeDxClient, input: TreeDxFederatedQueryRequest): Promise<TreeDxFederatedQueryResult> {
    return this.request<Record<string, unknown>>('POST', '/api/v1/query', input, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxFederatedQueryResult>(payload, ['query']));
}
