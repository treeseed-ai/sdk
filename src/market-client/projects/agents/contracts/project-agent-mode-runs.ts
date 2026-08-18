import type { CapacityPage } from "../../../../capacity/capacity-core/capacity-pagination.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function projectAgentModeRunsMethod(this: MarketClient, projectId: string, options: {
    mode?: string | null;
    assignmentId?: string | null;
    limit?: number;
    cursor?: string | null;
	projection?: 'activity' | null;
} = {}) {
    const params = new URLSearchParams();
    if (options.mode)
        params.set('mode', options.mode);
    if (options.assignmentId)
        params.set('assignmentId', options.assignmentId);
    if (options.limit !== undefined)
        params.set('limit', String(options.limit));
    if (options.cursor)
        params.set('cursor', options.cursor);
	if (options.projection)
		params.set('projection', options.projection);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{
        ok: true;
        payload: CapacityPage<Record<string, unknown>>;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/agent-mode-runs${query}`, { requireAuth: true });
}
