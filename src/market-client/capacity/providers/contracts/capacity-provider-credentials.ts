import type { ProviderTeamCredentialMetadata } from "../../../../capacity-provider/contracts/index.ts";
import type { CapacityPage } from "../../../../capacity/capacity-core/capacity-pagination.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityProviderCredentialsMethod(this: MarketClient, teamId: string, membershipId: string, filters: {
    status?: string | null;
    limit?: number;
    cursor?: string;
} = {}) {
    const query = new URLSearchParams();
    if (filters.status)
        query.set('status', filters.status);
    if (filters.limit !== undefined)
        query.set('limit', String(filters.limit));
    if (filters.cursor)
        query.set('cursor', filters.cursor);
    return this.request<{
        ok: true;
        payload: CapacityPage<ProviderTeamCredentialMetadata>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-provider-memberships/${encodeURIComponent(membershipId)}/credentials${query.size ? `?${query}` : ''}`, { requireAuth: true });
}
