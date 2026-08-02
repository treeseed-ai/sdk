import type { SdkGraphQueryOptions } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function followReferencesMethod(this: AgentSdk, id: string, options?: SdkGraphQueryOptions) {
    return this.localGraphRuntime.followReferences(id, options);
}
