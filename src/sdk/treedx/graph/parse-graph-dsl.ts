import type { SdkGraphDslParseResult } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function parseGraphDslMethod(this: AgentSdk, source: string): Promise<SdkGraphDslParseResult> {
    return this.graph.parseGraphDsl(source);
}
