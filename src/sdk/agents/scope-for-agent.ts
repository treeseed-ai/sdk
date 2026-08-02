import { AgentSdk,ScopedAgentSdk } from "../../entrypoints/models/sdk.ts";
import type { AgentRuntimeSpec } from "../../types/agents.ts";
export function scopeForAgentMethod(this: AgentSdk, agent: Pick<AgentRuntimeSpec, 'slug' | 'permissions'>) {
    return new ScopedAgentSdk(this, agent.slug, agent.permissions);
}
