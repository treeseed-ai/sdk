import type { WorkdayCapacitySummaryPayload } from "../../../../capacity/agents/agent-capacity.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function workdaySummaryMethod(this: MarketClient, workdayId: string, options: {
    evidence?: 'assignments' | 'mode-runs' | 'reservations' | 'usage-actuals' | 'ledger-entries' | null;
    limit?: number;
    cursor?: string | null;
} = {}) {
    const params = new URLSearchParams();
    if (options.evidence)
        params.set('evidence', options.evidence);
    if (options.limit !== undefined)
        params.set('limit', String(options.limit));
    if (options.cursor)
        params.set('cursor', options.cursor);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{
        ok: true;
        payload: WorkdayCapacitySummaryPayload;
    }>(`/v1/workdays/${encodeURIComponent(workdayId)}/summary${query}`, { requireAuth: true });
}
