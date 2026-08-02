import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
import type { TreeDxProjectLibraryBinding } from "../../../../entrypoints/models/sdk-types.ts";
export function upsertProjectTreeDxLibraryMethod(this: MarketClient, projectId: string, body: Partial<TreeDxProjectLibraryBinding> & Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: TreeDxProjectLibraryBinding;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/treedx-library`, { method: 'POST', body, requireAuth: true });
}
