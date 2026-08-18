import type { ListApprovalRequestsRequest } from "../../../entrypoints/models/sdk-types.ts";
import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export async function listApprovalRequestsMethod(this: MemoryAgentDatabase, request: ListApprovalRequestsRequest = {}) {
    const states = request.state
        ? new Set((Array.isArray(request.state) ? request.state : [request.state]).map(String))
        : null;
    return [...this.approvalRequests.values()]
        .filter((approval) => !request.projectId || approval.projectId === request.projectId)
        .filter((approval) => !request.teamId || approval.teamId === request.teamId)
        .filter((approval) => !states || states.has(approval.state))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, request.limit ?? 100);
}
