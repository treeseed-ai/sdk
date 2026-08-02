import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function createProjectAgentClassMethod(this: MarketClient, projectId: string, body: Record<string, unknown>, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/agent-classes`, { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey }, requireAuth: true });
}
