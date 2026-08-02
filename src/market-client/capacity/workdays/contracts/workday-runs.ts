import type { CapacityPage } from "../../../../capacity/capacity-core/capacity-pagination.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function workdayRunsMethod(this: MarketClient, teamId: string, options: {
    status?: string | null;
    providerId?: string | null;
    limit?: number;
    cursor?: string | null;
} = {}) {
    const params = new URLSearchParams();
    if (options.status)
        params.set('status', options.status);
    if (options.providerId)
        params.set('providerId', options.providerId);
    if (options.limit !== undefined)
        params.set('limit', String(options.limit));
    if (options.cursor)
        params.set('cursor', options.cursor);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{
        ok: true;
        payload: CapacityPage<Record<string, unknown>>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/workday-runs${query}`, { requireAuth: true });
}
