import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function deleteProjectMethod(this: MarketClient, projectId: string, confirmation: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
        job?: Record<string, unknown>;
    }>(`/v1/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE', body: { confirmation }, requireAuth: true });
}
