import type { SdkGraphRefreshRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function refreshGraphMethod(this: AgentSdk, request?: SdkGraphRefreshRequest) {
    return this.graph.refresh(request);
}
