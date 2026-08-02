import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxFederatedSearchRequest,TreeDxFederatedSearchResult } from "../../../../types.ts";
export function federatedSearchMethod(this: TreeDxClient, input: TreeDxFederatedSearchRequest): Promise<TreeDxFederatedSearchResult> {
    return this.request<Record<string, unknown>>('POST', '/api/v1/search', input, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxFederatedSearchResult>(payload, ['search']));
}
