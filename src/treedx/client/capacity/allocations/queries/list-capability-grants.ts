import { firstPayload,TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxCapabilityGrant } from "../../../../types.ts";
export function listCapabilityGrantsMethod(this: TreeDxClient, input: {
    actorId?: string;
    repoId?: string;
} = {}): Promise<TreeDxCapabilityGrant[]> {
    return this.request<Record<string, unknown>>('GET', '/api/v1/policy/grants', undefined, {
        query: input,
        tokenRequired: true,
    }).then((payload) => firstPayload<TreeDxCapabilityGrant[]>(payload, ['grants']));
}
