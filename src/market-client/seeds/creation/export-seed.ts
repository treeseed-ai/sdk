import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function exportSeedMethod(this: MarketClient, teamId: string, body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/v1/teams/${encodeURIComponent(teamId)}/seeds/export`, { method: 'POST', body, requireAuth: true });
}
