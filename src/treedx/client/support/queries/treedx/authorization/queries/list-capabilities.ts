import { TreeDxClient } from "../../../../../../support/client.ts";
export function listCapabilitiesMethod(this: TreeDxClient): Promise<{
    capabilities: string[];
}> {
    return this.request<{
        capabilities: string[];
    }>('GET', '/api/v1/policy/capabilities', undefined, { tokenRequired: true });
}
