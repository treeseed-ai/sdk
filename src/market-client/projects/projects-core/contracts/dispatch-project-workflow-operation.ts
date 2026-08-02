import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function dispatchProjectWorkflowOperationMethod(this: MarketClient, projectId: string, operationId: string, body: Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: unknown;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/workflow-operations/${encodeURIComponent(operationId)}/dispatch`, { method: 'POST', body, requireAuth: true });
}
