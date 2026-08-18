import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxGraphRefreshJob,TreeDxGraphRefreshJobRequest } from "../../../../types.ts";
export function getGraphRefreshJobMethod(this: TreeDxClient, input: TreeDxGraphRefreshJobRequest): Promise<TreeDxGraphRefreshJob> {
    return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/graph/refresh-jobs/${encodeURIComponent(input.jobId)}`, undefined, { query: { ref: input.ref }, tokenRequired: true }).then((payload) => firstPayload<TreeDxGraphRefreshJob>(payload, ['job']));
}
