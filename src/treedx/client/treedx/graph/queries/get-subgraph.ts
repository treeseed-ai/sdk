import { TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxGraphSubgraphRequest } from "../../../../types.ts";
export function getSubgraphMethod(this: TreeDxClient, input: TreeDxGraphSubgraphRequest) {
    const { repoId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/subgraph`, body, { tokenRequired: true });
}
