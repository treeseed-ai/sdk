import type { SdkAckMessageRequest } from "../../../entrypoints/models/sdk-types.ts";
import { MemoryAgentDatabase,nowIso } from "../../../persistence/d1-store.ts";
export async function ackMessageMethod(this: MemoryAgentDatabase, request: SdkAckMessageRequest) {
    const current = this.messages.get(request.id);
    if (!current) {
        return;
    }
    this.messages.set(request.id, {
        ...current,
        status: request.status,
        updatedAt: nowIso(),
    });
}
