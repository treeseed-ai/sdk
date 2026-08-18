import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxListTreeRequest,TreeDxTreeEntry } from "../../../../../../types.ts";
export function listTreeMethod(this: TreeDxClient, input: TreeDxListTreeRequest): Promise<TreeDxTreeEntry[]> {
    return this.request<Record<string, unknown>>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/tree`, undefined, {
        query: { path: input.path ?? '', includeDeleted: input.includeDeleted },
        tokenRequired: true,
    }).then((payload) => firstPayload<TreeDxTreeEntry[]>(payload, ['entries']));
}
