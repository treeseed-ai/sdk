import { firstPayload,TreeDxClient } from "../../../support/client.ts";
import type { TreeDxArtifact,TreeDxArtifactDeleteRequest } from "../../../types.ts";
export function deleteArtifactMethod(this: TreeDxClient, input: TreeDxArtifactDeleteRequest): Promise<TreeDxArtifact> {
    return this.request<Record<string, unknown>>('DELETE', `/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/artifacts/${encodeURIComponent(input.artifactId)}`, undefined, { tokenRequired: true }).then((payload) => firstPayload<TreeDxArtifact>(payload, ['artifact']));
}
