import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function teamDeletionBlockersMethod(this: MarketClient, teamId: string) {
    return this.request<{
        ok: true;
        payload: Array<Record<string, unknown>>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/deletion-blockers`, { requireAuth: true });
}
