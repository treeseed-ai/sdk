import type { CapacityPage } from "../../../../capacity/capacity-core/capacity-pagination.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function projectAgentClassesMethod(this: MarketClient, projectId: string, page: {
    limit?: number;
    cursor?: string | null;
} = {}) {
    const params = new URLSearchParams();
    if (page.limit !== undefined)
        params.set('limit', String(page.limit));
    if (page.cursor)
        params.set('cursor', page.cursor);
    return this.request<{
        ok: true;
        payload: CapacityPage<Record<string, unknown>>;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/agent-classes${params.size ? `?${params}` : ''}`, { requireAuth: true });
}
