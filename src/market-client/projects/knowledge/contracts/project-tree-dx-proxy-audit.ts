import type { CapacityPage } from "../../../../capacity/capacity-core/capacity-pagination.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function projectTreeDxProxyAuditMethod(this: MarketClient, projectId: string, options: {
    assignmentId?: string | null;
    actorType?: string | null;
    limit?: number;
    cursor?: string | null;
} = {}) {
    const query = new URLSearchParams();
    if (options.assignmentId)
        query.set('assignmentId', options.assignmentId);
    if (options.actorType)
        query.set('actorType', options.actorType);
    if (options.limit !== undefined)
        query.set('limit', String(options.limit));
    if (options.cursor)
        query.set('cursor', options.cursor);
    return this.request<{
        ok: true;
        payload: CapacityPage<Record<string, unknown>>;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/treedx-proxy-audit${query.toString() ? `?${query}` : ''}`, { requireAuth: true });
}
