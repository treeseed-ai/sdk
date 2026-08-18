import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxNode } from "../../../../../../types.ts";
export function getNodeMethod(this: TreeDxClient): Promise<TreeDxNode> {
    return this.request<Record<string, unknown>>('GET', '/api/v1/node', undefined, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxNode>(payload, ['node']));
}
