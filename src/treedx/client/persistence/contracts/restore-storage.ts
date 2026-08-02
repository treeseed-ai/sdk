import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxStorageRestoreRequest,TreeDxStorageRestoreResult } from "../../../types.ts";
export function restoreStorageMethod(this: TreeDxClient, input: TreeDxStorageRestoreRequest): Promise<TreeDxStorageRestoreResult['restore']> {
    return this.request<TreeDxStorageRestoreResult>('POST', '/api/v1/admin/storage/restore', input, { tokenRequired: true }).then((payload) => payload.restore);
}
