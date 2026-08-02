import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityProviderAssignmentsMethod(this: MarketClient, teamId: string, options: {
    projectId?: string | null;
    providerId?: string | null;
    status?: string | null;
    assignmentId?: string | null;
    workdayId?: string | null;
    executionProviderId?: string | null;
    view?: 'lifecycle' | null;
    limit?: number;
    cursor?: string | null;
} = {}) {
    const params = new URLSearchParams();
    if (options.projectId)
        params.set('projectId', options.projectId);
    if (options.providerId)
        params.set('providerId', options.providerId);
    if (options.status)
        params.set('status', options.status);
    if (options.assignmentId)
        params.set('assignmentId', options.assignmentId);
    if (options.workdayId)
        params.set('workdayId', options.workdayId);
    if (options.executionProviderId)
        params.set('executionProviderId', options.executionProviderId);
    if (options.view)
        params.set('view', options.view);
    if (options.limit !== undefined)
        params.set('limit', String(options.limit));
    if (options.cursor)
        params.set('cursor', options.cursor);
    const query = params.toString() ? `?${params.toString()}` : '';
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
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments${query}`, { requireAuth: true });
}
