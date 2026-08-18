import type { SdkGraphQueryOptions } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function getSubgraphMethod(this: AgentSdk, seedIds: string[], options?: SdkGraphQueryOptions) {
    return this.localGraphRuntime.getSubgraph(seedIds, options);
}
