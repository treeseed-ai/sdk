import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxRepositoryQueryResult,TreeDxRepositoryReadRequest } from "../../../types.ts";
export function readRepositoryFileMethod(this: TreeDxClient, input: TreeDxRepositoryReadRequest): Promise<TreeDxRepositoryQueryResult> {
    return this.readRepositoryFiles(input);
}
