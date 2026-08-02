import type { SdkClaimMessageRequest,SdkMessageEntity } from "../../../entrypoints/models/sdk-types.ts";
import { MemoryAgentDatabase,nowIso } from "../../../persistence/d1-store.ts";
export async function claimMessageMethod(this: MemoryAgentDatabase, request: SdkClaimMessageRequest) {
    const pending = [...this.messages.values()]
        .filter((message) => (message.status === 'pending' || message.status === 'failed')
        && new Date(message.availableAt).valueOf() <= Date.now()
        && (!request.messageTypes?.length || request.messageTypes.includes(message.type)))
        .sort((left, right) => right.priority - left.priority || left.availableAt.localeCompare(right.availableAt))[0];
    if (!pending) {
        return null;
    }
    const claimedAt = nowIso();
    const next: SdkMessageEntity = {
        ...pending,
        status: 'claimed',
        claimedBy: request.workerId,
        claimedAt,
        leaseExpiresAt: new Date(Date.now() + request.leaseSeconds * 1000).toISOString(),
        attempts: pending.attempts + 1,
        updatedAt: claimedAt,
    };
    this.messages.set(next.id, next);
    return next;
}
