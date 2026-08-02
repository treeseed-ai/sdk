import { TreeDxClient } from "../../../../support/client.ts";
import type { SdkGraphSearchResult,TreeDxGraphSearchRequest } from "../../../../types.ts";
export function searchGraphEntitiesMethod(this: TreeDxClient, input: TreeDxGraphSearchRequest): Promise<SdkGraphSearchResult[]> {
    return this.graphSearch('/graph/search-entities', input);
}
