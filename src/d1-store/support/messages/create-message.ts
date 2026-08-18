import type { SdkCreateMessageRequest,SdkMessageEntity } from "../../../entrypoints/models/sdk-types.ts";
import { MemoryAgentDatabase,nowIso } from "../../../persistence/d1-store.ts";
export async function createMessageMethod(this: MemoryAgentDatabase, request: SdkCreateMessageRequest) {
    this.messageId += 1;
    const record: SdkMessageEntity = {
        id: this.messageId,
        type: request.type,
        status: 'pending',
        payloadJson: JSON.stringify(request.payload),
        relatedModel: request.relatedModel ?? null,
        relatedId: request.relatedId ?? null,
        priority: request.priority ?? 0,
        availableAt: nowIso(),
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        attempts: 0,
        maxAttempts: request.maxAttempts ?? 3,
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };
    this.messages.set(record.id, record);
    return record;
}
