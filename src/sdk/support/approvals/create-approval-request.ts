import type { CreateApprovalRequestRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function createApprovalRequestMethod(this: AgentSdk, request: CreateApprovalRequestRequest) {
    const payload = await this.database.createApprovalRequest(request);
    return this.envelope('approval_request', 'create', payload);
}
