import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function createDecisionExecutionInputMethod(this: MarketClient, decisionId: string, body: Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/decisions/${encodeURIComponent(decisionId)}/execution-inputs`, { method: 'POST', body, requireAuth: true });
}
