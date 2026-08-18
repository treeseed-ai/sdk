import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
import type { TreeDxMirror } from "../../../../entrypoints/models/sdk-types.ts";
export function syncTreeDxMirrorMethod(this: MarketClient, teamId: string, mirrorId: string, body: Record<string, unknown> = {}) {
    return this.request<{
        ok: true;
        payload: TreeDxMirror;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/treedx/mirrors/${encodeURIComponent(mirrorId)}/sync`, { method: 'POST', body, requireAuth: true });
}
