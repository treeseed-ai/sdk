import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function createResearchWorkflowMethod(this: MarketClient, projectId: string, body: Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/research-workflows`, { method: 'POST', body, requireAuth: true });
}
