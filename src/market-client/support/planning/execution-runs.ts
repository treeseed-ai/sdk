import type { CapacityPage } from "../../../capacity/capacity-core/capacity-pagination.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function executionRunsMethod(this: MarketClient, teamId: string, options: {
    projectId?: string | null;
    providerId?: string | null;
    status?: string | null;
    mode?: string | null;
    assignmentId?: string | null;
    workdayId?: string | null;
    executionProviderId?: string | null;
    limit?: number;
    cursor?: string | null;
} = {}) {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(options)) {
        if (value !== undefined && value !== null && value !== '')
            params.set(name, String(value));
    }
    return this.request<{
        ok: true;
        payload: CapacityPage<Record<string, unknown>>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/execution-runs${params.size ? `?${params}` : ''}`, { requireAuth: true });
}
