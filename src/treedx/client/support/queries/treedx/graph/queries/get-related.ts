import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxGraphRelatedRequest } from "../../../../../../types.ts";
export function getRelatedMethod(this: TreeDxClient, input: TreeDxGraphRelatedRequest) {
    const { repoId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/related`, body, { tokenRequired: true });
}
