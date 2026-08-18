import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxArtifact,TreeDxArtifactGetRequest } from "../../../../../../types.ts";
export function getArtifactMethod(this: TreeDxClient, input: TreeDxArtifactGetRequest): Promise<TreeDxArtifact> {
    return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/artifacts/${encodeURIComponent(input.artifactId)}`, undefined, { tokenRequired: true }).then((payload) => firstPayload<TreeDxArtifact>(payload, ['artifact']));
}
