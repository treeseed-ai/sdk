import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxEffectiveScope,TreeDxEffectiveScopeRequest } from "../../../../../../types.ts";
export function effectiveScopeMethod(this: TreeDxClient, input: TreeDxEffectiveScopeRequest = {}): Promise<TreeDxEffectiveScope> {
    return this.request<TreeDxEffectiveScope>('GET', '/api/v1/policy/effective-scope', undefined, {
        query: { repoId: input.repoId },
        tokenRequired: true,
    });
}
