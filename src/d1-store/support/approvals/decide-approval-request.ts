import type { DecideApprovalRequestRequest } from "../../../entrypoints/models/sdk-types.ts";
import { decidedApprovalRequest,MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export async function decideApprovalRequestMethod(this: MemoryAgentDatabase, id: string, request: DecideApprovalRequestRequest) {
    const existing = this.approvalRequests.get(id);
    if (!existing)
        return null;
    const decided = decidedApprovalRequest(existing, request);
    this.approvalRequests.set(id, decided);
    return decided;
}
