import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxDeepHealth } from "../../../../../../types.ts";
export function deepHealthMethod(this: TreeDxClient, input: {
    admin?: boolean;
} = {}): Promise<TreeDxDeepHealth> {
    return this.request<Record<string, unknown>>('GET', input.admin ? '/api/v1/admin/health/deep' : '/api/v1/health/deep', undefined, { tokenRequired: input.admin === true }).then((payload) => firstPayload<TreeDxDeepHealth>(payload, ['health']));
}
