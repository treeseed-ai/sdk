import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
import type { TreeDxShareLink } from "../../../../entrypoints/models/sdk-types.ts";
export function createTreeDxShareMethod(this: MarketClient, teamId: string, body: Partial<TreeDxShareLink> & Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: TreeDxShareLink;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/treedx/shares`, { method: 'POST', body, requireAuth: true });
}
