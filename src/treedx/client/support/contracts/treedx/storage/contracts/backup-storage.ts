import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxStorageBackupRequest,TreeDxStorageBackupResult } from "../../../../../../types.ts";
export function backupStorageMethod(this: TreeDxClient, input: TreeDxStorageBackupRequest = {}): Promise<TreeDxStorageBackupResult> {
    return this.request<TreeDxStorageBackupResult>('POST', '/api/v1/admin/storage/backup', input, {
        tokenRequired: true,
    });
}
