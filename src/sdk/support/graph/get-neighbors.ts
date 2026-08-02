import type { SdkGraphQueryOptions } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function getNeighborsMethod(this: AgentSdk, id: string, options?: SdkGraphQueryOptions) {
    return this.localGraphRuntime.getNeighbors(id, options);
}
