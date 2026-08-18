import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function planCapacityGrantMethod(this: MarketClient, teamId: string, body: Record<string, unknown>) {
    return this.request<{
        ok: boolean;
        payload: {
            candidate: Record<string, unknown>;
            validation: {
                ok: boolean;
                diagnostics: unknown[];
            };
        };
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-grants/plan`, { method: 'POST', body, requireAuth: true });
}
