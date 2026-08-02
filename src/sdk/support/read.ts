import type { SdkGetRequest } from "../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../entrypoints/models/sdk.ts";
export function readMethod(this: AgentSdk, request: SdkGetRequest) {
    return this.get(request).then((response) => ({
        ...response,
        operation: 'read' as const,
    }));
}
