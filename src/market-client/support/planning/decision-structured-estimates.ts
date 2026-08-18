import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function decisionStructuredEstimatesMethod(this: MarketClient, decisionId: string, status?: string) {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request<{
        ok: true;
        payload: Record<string, unknown>[];
    }>(`/v1/decisions/${encodeURIComponent(decisionId)}/estimates${query}`, { requireAuth: true });
}
