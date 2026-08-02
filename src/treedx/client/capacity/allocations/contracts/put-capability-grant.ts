import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxCapabilityGrant } from "../../../../types.ts";
export function putCapabilityGrantMethod(this: TreeDxClient, input: TreeDxCapabilityGrant): Promise<TreeDxCapabilityGrant> {
    return this.request<Record<string, unknown>>('POST', '/api/v1/policy/grants', input, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxCapabilityGrant>(payload, ['grant']));
}
