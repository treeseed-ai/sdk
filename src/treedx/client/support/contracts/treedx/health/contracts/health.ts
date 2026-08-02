import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxHealth } from "../../../../../../types.ts";
export function healthMethod(this: TreeDxClient): Promise<TreeDxHealth> {
    return this.request<TreeDxHealth>('GET', '/api/v1/health');
}
