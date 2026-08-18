import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function researchWorkflowMethod(this: MarketClient, workflowId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/research-workflows/${encodeURIComponent(workflowId)}`, { requireAuth: true });
}
