import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxStorageRestoreResult,TreeDxStorageRestoreVerifyRequest } from "../../../types.ts";
export function verifyStorageRestoreMethod(this: TreeDxClient, input: TreeDxStorageRestoreVerifyRequest): Promise<TreeDxStorageRestoreResult['restore']> {
    return this.request<TreeDxStorageRestoreResult>('POST', '/api/v1/admin/storage/restore/verify', input, { tokenRequired: true }).then((payload) => payload.restore);
}
