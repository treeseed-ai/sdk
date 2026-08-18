import { firstPayload,TreeDxClient } from "../../../support/client.ts";
import type { TreeDxArtifactCleanupRequest,TreeDxArtifactCleanupResult } from "../../../types.ts";
export function cleanupArtifactsMethod(this: TreeDxClient, input: TreeDxArtifactCleanupRequest = {}): Promise<TreeDxArtifactCleanupResult> {
    return this.request<Record<string, unknown>>('POST', '/api/v1/admin/artifacts/cleanup', input, { tokenRequired: true }).then((payload) => firstPayload<TreeDxArtifactCleanupResult>(payload, ['cleanup']));
}
