import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxReadiness } from "../../../../../../types.ts";
export function readyMethod(this: TreeDxClient): Promise<TreeDxReadiness> {
    return this.request<Record<string, unknown>>('GET', '/api/v1/ready')
        .then((payload) => firstPayload<TreeDxReadiness>(payload, ['readiness']));
}
