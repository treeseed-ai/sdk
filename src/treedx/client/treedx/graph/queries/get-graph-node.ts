import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxGraphNodeRequest } from "../../../../types.ts";
export function getGraphNodeMethod(this: TreeDxClient, input: TreeDxGraphNodeRequest) {
    return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/graph/nodes/${encodeURIComponent(input.nodeId)}`, undefined, {
        query: { ref: input.ref },
        tokenRequired: true,
    }).then((payload) => firstPayload(payload, ['node']));
}
