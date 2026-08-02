import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function explainReferenceChainMethod(this: AgentSdk, fromId: string, toId: string) {
    return this.localGraphRuntime.explainReferenceChain(fromId, toId);
}
