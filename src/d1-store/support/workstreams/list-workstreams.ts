import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export function listWorkstreamsMethod(this: MemoryAgentDatabase, projectId: string) {
    return Promise.resolve(this.projectWorkflow.listWorkstreams(projectId));
}
