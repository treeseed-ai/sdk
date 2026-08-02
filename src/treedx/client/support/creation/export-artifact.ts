import { firstPayload,TreeDxClient } from "../../../support/client.ts";
import type { TreeDxArtifact,TreeDxArtifactExportRequest } from "../../../types.ts";
export function exportArtifactMethod(this: TreeDxClient, input: TreeDxArtifactExportRequest = {}): Promise<TreeDxArtifact> {
    const { repoId, ...body } = input;
    return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/artifacts/export`, body, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxArtifact>(payload, ['artifact']));
}
