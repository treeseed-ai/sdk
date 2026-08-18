import { firstPayload,TreeDxClient } from "../../../support/client.ts";
import type { TreeDxSearchIndexRefreshRequest,TreeDxSearchIndexRefreshResult } from "../../../types.ts";
export function refreshSearchIndexMethod(this: TreeDxClient, input: TreeDxSearchIndexRefreshRequest = {}): Promise<TreeDxSearchIndexRefreshResult> {
    const { repoId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/search/index/refresh`, body, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxSearchIndexRefreshResult>(payload, ['index']));
}
