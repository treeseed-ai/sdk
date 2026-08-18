import { D1Record,MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export function rowsForModelMethod(this: MemoryAgentDatabase, model: string): D1Record[] {
    if (model === 'subscription') {
        return [...this.subscriptions.values()];
    }
    if (model === 'message') {
        return [...this.messages.values()];
    }
    if (model === 'agent_run') {
        return [...this.runs.values()];
    }
    if (model === 'agent_cursor') {
        return [...this.cursors.entries()].map(([key, value]) => {
            const [agentSlug, cursorKey] = key.split(':', 2);
            return {
                agentSlug,
                cursorKey,
                cursorValue: value,
                updatedAt: null,
            };
        });
    }
    if (model === 'content_lease') {
        return [...this.contentLeases.values()].map((lease) => ({
            model: lease.model,
            itemKey: lease.itemKey,
            claimedBy: lease.claimedBy,
            claimedAt: lease.claimedAt,
            leaseExpiresAt: lease.leaseExpiresAt,
            token: lease.token,
        }));
    }
    throw new Error(`Unsupported D1 model "${model}".`);
}
