import type { SdkGraphQueryRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function queryGraphMethod(this: AgentSdk, request: SdkGraphQueryRequest) {
    return this.graph.queryGraph(request);
}
