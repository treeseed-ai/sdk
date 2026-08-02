import { TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxMirrorPromotionRequest,TreeDxMirrorPromotionResult } from "../../../../types.ts";
export function promoteMirrorMethod(this: TreeDxClient, input: TreeDxMirrorPromotionRequest): Promise<TreeDxMirrorPromotionResult> {
    const { repoId, mirrorId, ...body } = input;
    return this.request<TreeDxMirrorPromotionResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/mirrors/${encodeURIComponent(mirrorId)}/promote`, body, { tokenRequired: true });
}
