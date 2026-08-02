import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
import type { TreeDxMirror } from "../../../../entrypoints/models/sdk-types.ts";
export function treeDxMirrorsMethod(this: MarketClient, teamId: string) {
    return this.request<{
        ok: true;
        payload: TreeDxMirror[];
    }>(`/v1/teams/${encodeURIComponent(teamId)}/treedx/mirrors`, { requireAuth: true });
}
