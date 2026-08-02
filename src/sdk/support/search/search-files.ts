import type { SdkGraphSearchOptions } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function searchFilesMethod(this: AgentSdk, query: string, options?: SdkGraphSearchOptions) {
    return this.localGraphRuntime.searchFiles(query, options);
}
