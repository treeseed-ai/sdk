import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function projectDeletionBlockersMethod(this: MarketClient, projectId: string) {
    return this.request<{
        ok: true;
        payload: Array<Record<string, unknown>>;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/deletion-blockers`, { requireAuth: true });
}
