import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
import type { TreeDxInstance,TreeDxMirror,TreeDxShareLink } from "../../../../entrypoints/models/sdk-types.ts";
export function teamTreeDxMethod(this: MarketClient, teamId: string) {
    return this.request<{
        ok: true;
        payload: {
            instance: TreeDxInstance | null;
            mirrors: TreeDxMirror[];
            shares: TreeDxShareLink[];
            deployments: unknown[];
        };
    }>(`/v1/teams/${encodeURIComponent(teamId)}/treedx`, { requireAuth: true });
}
