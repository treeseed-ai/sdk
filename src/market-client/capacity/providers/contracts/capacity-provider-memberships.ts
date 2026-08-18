import type { ProviderTeamMembership } from "../../../../capacity-provider/contracts/index.ts";
import type { CapacityPage } from "../../../../capacity/capacity-core/capacity-pagination.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityProviderMembershipsMethod(this: MarketClient, teamId: string, filters: {
    status?: string | null;
    providerId?: string | null;
    limit?: number;
    cursor?: string;
} = {}) {
    const query = new URLSearchParams();
    if (filters.status)
        query.set('status', filters.status);
    if (filters.providerId)
        query.set('providerId', filters.providerId);
    if (filters.limit !== undefined)
        query.set('limit', String(filters.limit));
    if (filters.cursor)
        query.set('cursor', filters.cursor);
    return this.request<{
        ok: true;
        payload: CapacityPage<ProviderTeamMembership>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-provider-memberships${query.size ? `?${query}` : ''}`, { requireAuth: true });
}
