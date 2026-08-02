import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxStorageCompactRequest,TreeDxStorageCompactResult } from "../../../../../../types.ts";
export function compactStorageMethod(this: TreeDxClient, input: TreeDxStorageCompactRequest = {}): Promise<TreeDxStorageCompactResult> {
    return this.request<TreeDxStorageCompactResult>('POST', '/api/v1/admin/storage/compact', input, {
        tokenRequired: true,
    });
}
