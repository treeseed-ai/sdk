import { TreeDxClient } from "../../../../support/client.ts";
import type { TreeDxFederationQueryPlan,TreeDxFederationQueryPlanRequest } from "../../../../types.ts";
export function planFederatedQueryMethod(this: TreeDxClient, input: TreeDxFederationQueryPlanRequest): Promise<TreeDxFederationQueryPlan> {
    return this.request<TreeDxFederationQueryPlan>('POST', '/api/v1/federation/query/plan', input, { tokenRequired: true });
}
