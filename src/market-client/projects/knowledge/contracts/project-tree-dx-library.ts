import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
import type { TreeDxProjectLibraryBinding } from "../../../../entrypoints/models/sdk-types.ts";
export function projectTreeDxLibraryMethod(this: MarketClient, projectId: string) {
    return this.request<{
        ok: true;
        payload: TreeDxProjectLibraryBinding | null;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/treedx-library`, { requireAuth: true });
}
