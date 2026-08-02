import { TreeDxClient } from "../../../support/client.ts";
import type { TreeDxAuthMode } from "../../../types.ts";
export function authModeMethod(this: TreeDxClient): Promise<TreeDxAuthMode> {
    return this.request<TreeDxAuthMode>('GET', '/api/v1/auth/mode');
}
