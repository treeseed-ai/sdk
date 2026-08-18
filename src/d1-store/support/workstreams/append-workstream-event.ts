import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
import type { WorkstreamEvent } from "../../../projects/projects-core/project-workflow.ts";
export function appendWorkstreamEventMethod(this: MemoryAgentDatabase, input: Pick<WorkstreamEvent, 'projectId' | 'workstreamId' | 'kind'> & Partial<WorkstreamEvent>) {
    return Promise.resolve(this.projectWorkflow.appendWorkstreamEvent(input));
}
