import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
import type { TreeDxShareLink } from "../../../../entrypoints/models/sdk-types.ts";
export function treeDxSharesMethod(this: MarketClient, teamId: string) {
    return this.request<{
        ok: true;
        payload: TreeDxShareLink[];
    }>(`/v1/teams/${encodeURIComponent(teamId)}/treedx/shares`, { requireAuth: true });
}
