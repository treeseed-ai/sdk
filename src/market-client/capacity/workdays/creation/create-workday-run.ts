import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function createWorkdayRunMethod(this: MarketClient, teamId: string, body: Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/workday-runs`, { method: 'POST', body, requireAuth: true });
}
