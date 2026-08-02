import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxSearchIndexCompactRequest,TreeDxSearchIndexCompactResult } from "../../../../../../types.ts";
export function compactSearchIndexMethod(this: TreeDxClient, input: TreeDxSearchIndexCompactRequest = {}): Promise<TreeDxSearchIndexCompactResult> {
    const { repoId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/search/index/compact`, body, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxSearchIndexCompactResult>(payload, ['compact']));
}
