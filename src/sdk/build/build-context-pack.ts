import type { SdkContextPackRequest } from '../../entrypoints/models/sdk-types.ts';
import { AgentSdk } from '../../entrypoints/models/sdk.ts';
export function buildContextPackMethod(this: AgentSdk, request: SdkContextPackRequest) {
    return this.graph.buildContextPack(request);
}
