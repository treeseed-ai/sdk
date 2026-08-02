import { TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxBlobDownload,TreeDxBlobDownloadRequest } from "../../../../types.ts";
export function downloadBlobMethod(this: TreeDxClient, input: TreeDxBlobDownloadRequest): Promise<TreeDxBlobDownload> {
    return this.requestBlobDownload(input);
}
