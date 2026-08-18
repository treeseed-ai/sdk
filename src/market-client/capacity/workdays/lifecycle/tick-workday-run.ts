import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function tickWorkdayRunMethod(this: MarketClient, teamId: string, runId: string, body: {
    idempotencyKey: string;
    now?: string;
}) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/workday-runs/${encodeURIComponent(runId)}/tick`, { method: 'POST', body, requireAuth: true });
}
