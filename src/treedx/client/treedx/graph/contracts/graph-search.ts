import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { SdkGraphSearchResult,TreeDxGraphSearchRequest } from "../../../../types.ts";
export function graphSearchMethod(this: TreeDxClient, path: string, input: TreeDxGraphSearchRequest): Promise<SdkGraphSearchResult[]> {
    const { repoId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}${path}`, body, { tokenRequired: true })
        .then((payload) => firstPayload<SdkGraphSearchResult[]>(payload, ['results']));
}
