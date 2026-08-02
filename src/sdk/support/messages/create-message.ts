import type { SdkCreateMessageRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function createMessageMethod(this: AgentSdk, request: SdkCreateMessageRequest) {
    const payload = await this.database.createMessage(request);
    return this.envelope('message', 'create', payload);
}
