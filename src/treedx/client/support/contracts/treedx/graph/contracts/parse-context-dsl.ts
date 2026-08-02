import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxCtxParseRequest,TreeDxCtxParseResult } from "../../../../../../types.ts";
export function parseContextDslMethod(this: TreeDxClient, input: TreeDxCtxParseRequest): Promise<TreeDxCtxParseResult> {
    const { repoId, ...body } = input;
    return this.request<TreeDxCtxParseResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/context/parse-ctx`, body, { tokenRequired: true });
}
