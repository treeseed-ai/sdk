import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxAuditEvent } from "../../../../../../types.ts";
export function listAuditEventsMethod(this: TreeDxClient, input: {
    actorId?: string;
    tenantId?: string;
    repoId?: string;
    eventType?: string;
    limit?: number;
} = {}): Promise<{
    events: TreeDxAuditEvent[];
    page: {
        limit: number;
        hasMore: boolean;
    };
}> {
    return this.request<{
        events: TreeDxAuditEvent[];
        page: {
            limit: number;
            hasMore: boolean;
        };
    }>('GET', '/api/v1/audit/events', undefined, { query: input, tokenRequired: true });
}
