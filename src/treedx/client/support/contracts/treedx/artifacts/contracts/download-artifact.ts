import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxArtifactDownload,TreeDxArtifactExportRequest } from "../../../../../../types.ts";
export function downloadArtifactMethod(this: TreeDxClient, input: TreeDxArtifactExportRequest = {}): Promise<TreeDxArtifactDownload> {
    const { repoId, ...body } = input;
    return this.requestBinary(`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/artifacts/export`, body, {
        tokenRequired: true,
    });
}
