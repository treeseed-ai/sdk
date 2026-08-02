import type { CapacityPage } from "../../../../capacity/capacity-core/capacity-pagination.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityAuditEventsMethod(this: MarketClient, teamId: string, filters: {
    action?: string | null;
    resourceType?: string | null;
    providerId?: string | null;
    membershipId?: string | null;
    from?: string | null;
    to?: string | null;
    limit?: number;
    cursor?: string;
} = {}) {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null && value !== '')
            query.set(name, String(value));
    }
    return this.request<{
        ok: true;
        payload: CapacityPage<Record<string, unknown>>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-audit-events${query.size ? `?${query}` : ''}`, { requireAuth: true });
}
