import { TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxBlobMutationResult,TreeDxBlobUploadRequest } from "../../../../types.ts";
export function uploadBlobMethod(this: TreeDxClient, input: TreeDxBlobUploadRequest): Promise<TreeDxBlobMutationResult> {
    return this.requestBlobUpload(input);
}
