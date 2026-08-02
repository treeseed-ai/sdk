import type { DecideApprovalRequestRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function decideApprovalRequestMethod(this: AgentSdk, id: string, request: DecideApprovalRequestRequest) {
    const payload = await this.database.decideApprovalRequest(id, request);
    return this.envelope('approval_request', 'update', payload);
}
