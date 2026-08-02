import { firstPayload,TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxMetrics } from "../../../../../../types.ts";
export function metricsMethod(this: TreeDxClient): Promise<TreeDxMetrics> {
    return this.request<Record<string, unknown>>('GET', '/api/v1/metrics')
        .then((payload) => firstPayload<TreeDxMetrics>(payload, ['metrics']));
}
