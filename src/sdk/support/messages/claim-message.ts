import type { SdkClaimMessageRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function claimMessageMethod(this: AgentSdk, request: SdkClaimMessageRequest) {
    const payload = await this.database.claimMessage(request);
    return this.envelope('message', 'pick', payload, {
        claimed: Boolean(payload),
    });
}
