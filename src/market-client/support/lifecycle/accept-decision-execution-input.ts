import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function acceptDecisionExecutionInputMethod(this: MarketClient, inputId: string, body: Record<string, unknown> = {}) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/decision-execution-inputs/${encodeURIComponent(inputId)}/accept`, { method: 'POST', body, requireAuth: true });
}
