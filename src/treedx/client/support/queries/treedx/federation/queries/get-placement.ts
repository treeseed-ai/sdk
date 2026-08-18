import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxRepositoryPlacement } from "../../../../../../types.ts";
export function getPlacementMethod(this: TreeDxClient, repoId: string): Promise<TreeDxRepositoryPlacement> {
    return this.request<Record<string, unknown>>('GET', `/api/v1/registry/repos/${encodeURIComponent(repoId)}/placement`, undefined, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxRepositoryPlacement>(payload, ['placement']));
}
