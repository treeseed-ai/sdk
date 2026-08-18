import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxSearchIndexStatus,TreeDxSearchIndexStatusRequest } from "../../../../../../types.ts";
export function getSearchIndexStatusMethod(this: TreeDxClient, input: TreeDxSearchIndexStatusRequest = {}): Promise<TreeDxSearchIndexStatus> {
    return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/search/index/status`, undefined, { query: { ref: input.ref }, tokenRequired: true }).then((payload) => firstPayload<TreeDxSearchIndexStatus>(payload, ['index']));
}
