import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function teamMembersMethod(this: MarketClient, teamId: string) {
    return this.request<{
        ok: true;
        payload: unknown[];
    }>(`/v1/teams/${encodeURIComponent(teamId)}/members`, { requireAuth: true });
}
