import { TreeDxClient } from '../../../support/client.ts';
import type { TreeDxContextRequest,TreeDxContextResult } from '../../../types.ts';
export function buildContextMethod(this: TreeDxClient, input: TreeDxContextRequest): Promise<TreeDxContextResult> {
    const { repoId, ...body } = input;
    return this.request<TreeDxContextResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/context/build`, body, { tokenRequired: true });
}
