import crypto from 'node:crypto';
import type { UpsertTeamInboxItemRequest } from "../../entrypoints/models/sdk-types.ts";
import { inboxItemFromInput,MemoryAgentDatabase } from "../../persistence/d1-store.ts";
export async function upsertTeamInboxItemMethod(this: MemoryAgentDatabase, request: UpsertTeamInboxItemRequest) {
    const id = request.id ?? request.itemKey ?? crypto.randomUUID();
    const existing = this.teamInboxItems.get(id) ?? [...this.teamInboxItems.values()]
        .find((item) => request.itemKey && item.teamId === request.teamId && item.itemKey === request.itemKey) ?? null;
    const item = inboxItemFromInput({ ...request, id }, existing);
    this.teamInboxItems.set(item.id, item);
    return item;
}
