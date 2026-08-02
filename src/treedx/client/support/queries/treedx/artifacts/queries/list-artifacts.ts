import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxArtifact,TreeDxArtifactListRequest } from "../../../../../../types.ts";
export function listArtifactsMethod(this: TreeDxClient, input: TreeDxArtifactListRequest = {}): Promise<TreeDxArtifact[]> {
    return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/artifacts`, undefined, { tokenRequired: true }).then((payload) => firstPayload<TreeDxArtifact[]>(payload, ['artifacts']));
}
