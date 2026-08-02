import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function createWorkdayEventMethod(this: MarketClient, teamId: string, runId: string, body: Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/workday-runs/${encodeURIComponent(runId)}/events`, { method: 'POST', body, requireAuth: true });
}
