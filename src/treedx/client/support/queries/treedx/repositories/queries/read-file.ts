import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxFile,TreeDxReadFileRequest } from "../../../../../../types.ts";
export function readFileMethod(this: TreeDxClient, input: TreeDxReadFileRequest): Promise<TreeDxFile> {
    return this.request<TreeDxFile>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/files`, undefined, {
        query: { path: input.path, allowProtected: input.allowProtected },
        tokenRequired: true,
    });
}
