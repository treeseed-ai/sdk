import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function acceptStructuredAgentEstimateMethod(this: MarketClient, estimateId: string, body: Record<string, unknown> = {}) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/structured-agent-estimates/${encodeURIComponent(estimateId)}/accept`, { method: 'POST', body, requireAuth: true });
}
