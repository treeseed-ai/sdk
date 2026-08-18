import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export function resolveReferenceMethod(this: AgentSdk, reference: string, options?: {
    fromNodeId?: string;
    fromPath?: string;
    models?: string[];
}) {
    return this.localGraphRuntime.resolveReference(reference, options);
}
