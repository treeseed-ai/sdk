import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxRepository } from "../../../../../../types.ts";
export function listRepositoriesMethod(this: TreeDxClient): Promise<TreeDxRepository[]> {
    return this.request<Record<string, unknown>>('GET', '/api/v1/repos', undefined, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxRepository[]>(payload, ['repos', 'repositories', 'items']));
}
