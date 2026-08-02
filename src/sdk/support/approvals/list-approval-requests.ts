import type { ListApprovalRequestsRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function listApprovalRequestsMethod(this: AgentSdk, request: ListApprovalRequestsRequest = {}) {
    const payload = await this.database.listApprovalRequests(request);
    return this.envelope('approval_request', 'search', payload, { count: payload.length });
}
