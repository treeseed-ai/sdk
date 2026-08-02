import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function updateProjectAgentClassMethod(this: MarketClient, projectId: string, classId: string, body: Record<string, unknown>, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/agent-classes/${encodeURIComponent(classId)}`, { method: 'PATCH', body, headers: { 'Idempotency-Key': idempotencyKey }, requireAuth: true });
}
