import { TreeDxClient } from "../../../../../../support/client.ts";
export function queryMethod(this: TreeDxClient, params: Record<string, unknown> = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) {
            continue;
        }
        search.set(key, String(value));
    }
    const rendered = search.toString();
    return rendered ? `?${rendered}` : '';
}
