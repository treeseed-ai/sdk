import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityAllocationSetsMethod(this: MarketClient, teamId: string, page: {
    limit?: number;
    cursor?: string;
} = {}) {
    const query = new URLSearchParams();
    if (page.limit !== undefined)
        query.set('limit', String(page.limit));
    if (page.cursor)
        query.set('cursor', page.cursor);
    return this.request<{
        ok: true;
        payload: {
            items: unknown[];
            page: {
                limit: number;
                hasMore: boolean;
                nextCursor: string | null;
            };
        };
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets${query.size ? `?${query}` : ''}`, { requireAuth: true });
}
