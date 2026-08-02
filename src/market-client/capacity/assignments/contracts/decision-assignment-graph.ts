import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function decisionAssignmentGraphMethod(this: MarketClient, graphId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/decision-assignment-graphs/${encodeURIComponent(graphId)}`, { requireAuth: true });
}
