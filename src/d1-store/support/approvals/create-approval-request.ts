import type { CreateApprovalRequestRequest } from "../../../entrypoints/models/sdk-types.ts";
import { approvalRequestFromInput,MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export async function createApprovalRequestMethod(this: MemoryAgentDatabase, request: CreateApprovalRequestRequest) {
    const existing = request.id ? this.approvalRequests.get(request.id) : null;
    if (existing && existing.state !== 'pending')
        return existing;
    const approval = approvalRequestFromInput(request, existing);
    this.approvalRequests.set(approval.id, approval);
    return approval;
}
