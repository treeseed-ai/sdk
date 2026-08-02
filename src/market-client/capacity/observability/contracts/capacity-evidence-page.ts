import type { CapacityPage } from "../../../../capacity/capacity-core/capacity-pagination.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityEvidencePageMethod(this: MarketClient, teamId: string, collection: 'reservations' | 'usage' | 'ledger', options: {
    projectId: string;
    workDayId?: string | null;
    limit?: number;
    cursor?: string | null;
}) {
    const params = new URLSearchParams({ projectId: options.projectId });
    if (options.workDayId)
        params.set('workDayId', options.workDayId);
    if (options.limit !== undefined)
        params.set('limit', String(options.limit));
    if (options.cursor)
        params.set('cursor', options.cursor);
    return this.request<{
        ok: true;
        payload: CapacityPage<Record<string, unknown>>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/${collection}?${params}`, { requireAuth: true });
}
