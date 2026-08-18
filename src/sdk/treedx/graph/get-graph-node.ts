import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function getGraphNodeMethod(this: AgentSdk, id: string) {
    return this.localGraphRuntime.getNode(id);
}
