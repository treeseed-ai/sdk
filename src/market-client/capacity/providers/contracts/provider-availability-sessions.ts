import type { CapacityPage } from "../../../../capacity/capacity-core/capacity-pagination.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function providerAvailabilitySessionsMethod(this: MarketClient, teamId: string, options: {
    providerId?: string | null;
    status?: string | null;
    limit?: number;
    cursor?: string | null;
} = {}) {
    const params = new URLSearchParams();
    if (options.providerId)
        params.set('providerId', options.providerId);
    if (options.status)
        params.set('status', options.status);
    if (options.limit !== undefined)
        params.set('limit', String(options.limit));
    if (options.cursor)
        params.set('cursor', options.cursor);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{
        ok: true;
        payload: CapacityPage<Record<string, unknown>>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/availability-sessions${query}`, { requireAuth: true });
}
