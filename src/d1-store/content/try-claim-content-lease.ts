import { MemoryAgentDatabase,nextLeaseToken,nowIso,TryClaimContentLeaseInput } from "../../persistence/d1-store.ts";
export async function tryClaimContentLeaseMethod(this: MemoryAgentDatabase, input: TryClaimContentLeaseInput) {
    const key = `${input.model}:${input.itemKey}`;
    const existing = this.contentLeases.get(key);
    if (existing && new Date(existing.leaseExpiresAt).valueOf() > Date.now()) {
        return null;
    }
    const token = nextLeaseToken();
    this.contentLeases.set(key, {
        model: input.model,
        itemKey: input.itemKey,
        claimedBy: input.claimedBy,
        claimedAt: nowIso(),
        leaseExpiresAt: new Date(Date.now() + input.leaseSeconds * 1000).toISOString(),
        token,
    });
    return token;
}
