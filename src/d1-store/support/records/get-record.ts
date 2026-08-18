import type { SdkGetRequest } from "../../../entrypoints/models/sdk-types.ts";
import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export async function getMethod(this: MemoryAgentDatabase, request: SdkGetRequest) {
    const key = String(request.id ?? request.slug ?? request.key ?? '');
    if (request.model === 'agent_cursor') {
        if (!key) {
            return null;
        }
        const [agentSlug, cursorKey] = key.split(':', 2);
        const value = this.cursors.get(`${agentSlug}:${cursorKey}`);
        return value
            ? {
                agentSlug,
                cursorKey,
                cursorValue: value,
                updatedAt: null,
            }
            : null;
    }
    if (request.model === 'content_lease') {
        const lease = this.contentLeases.get(key);
        return lease
            ? {
                model: lease.model,
                itemKey: lease.itemKey,
                claimedBy: lease.claimedBy,
                claimedAt: lease.claimedAt,
                leaseExpiresAt: lease.leaseExpiresAt,
                token: lease.token,
            }
            : null;
    }
    return (this.rowsForModel(request.model).find((row) => [row.id, row.email, row.runId].map((value) => String(value ?? '')).includes(key)) ?? null) as Record<string, unknown> | null;
}
