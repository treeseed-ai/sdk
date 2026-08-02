import type { SdkLeaseReleaseRequest } from "../../entrypoints/models/sdk-types.ts";
import { MemoryAgentDatabase } from "../../persistence/d1-store.ts";
export async function releaseLeaseMethod(this: MemoryAgentDatabase, request: SdkLeaseReleaseRequest) {
    this.contentLeases.delete(`${request.model}:${request.itemKey}`);
}
