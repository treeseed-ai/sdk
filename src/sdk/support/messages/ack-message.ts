import type { SdkAckMessageRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function ackMessageMethod(this: AgentSdk, request: SdkAckMessageRequest) {
    await this.database.ackMessage(request);
    return this.envelope('message', 'update', { id: request.id, status: request.status });
}
