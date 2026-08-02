import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function updateWorkdayRunMethod(this: MarketClient, teamId: string, runId: string, body: Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/workday-runs/${encodeURIComponent(runId)}`, { method: 'PATCH', body, requireAuth: true });
}
