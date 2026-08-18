import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function createPlanningInputRequestMethod(this: MarketClient, decisionId: string, body: Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/decisions/${encodeURIComponent(decisionId)}/planning-input-requests`, { method: 'POST', body, requireAuth: true });
}
