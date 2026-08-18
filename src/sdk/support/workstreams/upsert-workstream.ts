import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
import type { WorkstreamSummary } from "../../../projects/projects-core/project-workflow.ts";
export async function upsertWorkstreamMethod(this: AgentSdk, input: Partial<WorkstreamSummary> & Pick<WorkstreamSummary, 'projectId' | 'title'>) {
    const payload = await this.database.upsertWorkstream(input);
    return this.envelope<WorkstreamSummary>('task', 'update', payload);
}
