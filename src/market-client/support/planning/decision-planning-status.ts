import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function decisionPlanningStatusMethod(this: MarketClient, decisionId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/decisions/${encodeURIComponent(decisionId)}/planning-status`, { requireAuth: true });
}
