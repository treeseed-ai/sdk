import { AgentSdk,normalizeAgentSpec } from "../../entrypoints/models/sdk.ts";
import type { AgentRuntimeSpec } from "../../types/agents.ts";
export async function listAgentSpecsMethod(this: AgentSdk, options?: {
    enabled?: boolean;
}) {
    const rawEntries = await this.listRawAgentSpecs(options);
    return rawEntries
        .map((entry) => normalizeAgentSpec(entry as Record<string, unknown>))
        .filter((entry): entry is AgentRuntimeSpec => Boolean(entry && entry.slug));
}
