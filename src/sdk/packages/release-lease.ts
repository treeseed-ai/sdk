import type { SdkLeaseReleaseRequest } from "../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../entrypoints/models/sdk.ts";
export async function releaseLeaseMethod(this: AgentSdk, request: SdkLeaseReleaseRequest) {
    await this.database.releaseLease(request);
    return this.envelope('content_lease', 'update', request);
}
