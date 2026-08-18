import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
import type { WorkstreamSummary } from "../../../projects/projects-core/project-workflow.ts";
export function upsertWorkstreamMethod(this: MemoryAgentDatabase, input: Partial<WorkstreamSummary> & Pick<WorkstreamSummary, 'projectId' | 'title'>) {
    return Promise.resolve(this.projectWorkflow.upsertWorkstream(input));
}
