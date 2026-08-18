import type { SdkGraphQueryRequest } from "../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../entrypoints/models/sdk.ts";
export function resolveSeedsMethod(this: AgentSdk, request: SdkGraphQueryRequest) {
    return this.localGraphRuntime.resolveSeeds(request);
}
