import { TreeDxClient } from "../../../../../../support/client.ts";
import type { TreeDxWhoami } from "../../../../../../types.ts";
export function whoamiMethod(this: TreeDxClient): Promise<TreeDxWhoami> {
    return this.request<TreeDxWhoami>('GET', '/api/v1/auth/whoami');
}
