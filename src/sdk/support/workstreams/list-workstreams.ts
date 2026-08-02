import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
import type { WorkstreamSummary } from "../../../projects/projects-core/project-workflow.ts";
export async function listWorkstreamsMethod(this: AgentSdk, projectId: string) {
    const payload = await this.database.listWorkstreams(projectId);
    return this.envelope<WorkstreamSummary[]>('task', 'search', payload, { count: payload.length });
}
