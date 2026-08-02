import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
import type { TreeDxInstance } from "../../../../entrypoints/models/sdk-types.ts";
export function updateTeamTreeDxMethod(this: MarketClient, teamId: string, body: Partial<TreeDxInstance> & Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: {
            instance: TreeDxInstance;
        };
    }>(`/v1/teams/${encodeURIComponent(teamId)}/treedx`, { method: 'PUT', body, requireAuth: true });
}
