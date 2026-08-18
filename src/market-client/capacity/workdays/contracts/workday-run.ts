import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function workdayRunMethod(this: MarketClient, teamId: string, runId: string) {
    return this.request<{
        ok: true;
        payload: {
            run: Record<string, unknown>;
            events: unknown[];
        };
    }>(`/v1/teams/${encodeURIComponent(teamId)}/workday-runs/${encodeURIComponent(runId)}`, { requireAuth: true });
}
