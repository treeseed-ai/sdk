import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function decisionAssignmentGraphsMethod(this: MarketClient, decisionId: string, options: {
    active?: boolean;
} = {}) {
    const query = options.active === undefined ? '' : `?active=${String(options.active)}`;
    return this.request<{
        ok: true;
        payload: Record<string, unknown>[];
    }>(`/v1/decisions/${encodeURIComponent(decisionId)}/assignment-graphs${query}`, { requireAuth: true });
}
