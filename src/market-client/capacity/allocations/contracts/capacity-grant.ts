import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityGrantMethod(this: MarketClient, teamId: string, grantId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-grants/${encodeURIComponent(grantId)}`, { requireAuth: true });
}
