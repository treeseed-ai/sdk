import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
import type { TreeDxMirror } from "../../../../entrypoints/models/sdk-types.ts";
export function createTreeDxMirrorMethod(this: MarketClient, teamId: string, body: Partial<TreeDxMirror> & Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: TreeDxMirror;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/treedx/mirrors`, { method: 'POST', body, requireAuth: true });
}
