import { MarketClient,TeamAccessSummary } from "../../../entrypoints/clients/market-client.ts";
export function teamPermissionsMethod(this: MarketClient, teamId: string) {
    return this.request<{
        ok: true;
        payload: TeamAccessSummary;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/permissions`, { requireAuth: true });
}
