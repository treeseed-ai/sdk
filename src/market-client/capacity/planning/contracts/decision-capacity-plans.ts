import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function decisionCapacityPlansMethod(this: MarketClient, decisionId: string, options: {
    status?: string | null;
} = {}) {
    const query = options.status ? `?status=${encodeURIComponent(options.status)}` : '';
    return this.request<{
        ok: true;
        payload: unknown[];
    }>(`/v1/decisions/${encodeURIComponent(decisionId)}/capacity-plans${query}`, { requireAuth: true });
}
