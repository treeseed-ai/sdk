import type { SdkGraphSearchOptions } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function searchEntitiesMethod(this: AgentSdk, query: string, options?: SdkGraphSearchOptions) {
    return this.localGraphRuntime.searchEntities(query, options);
}
