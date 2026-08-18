import { firstPayload,TreeDxClient } from "../../../support/client.ts";
import type { TreeDxRepository } from "../../../types.ts";
export function getRepositoryMethod(this: TreeDxClient, repoId?: string): Promise<TreeDxRepository> {
    return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}`, undefined, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxRepository>(payload, ['repo']));
}
