import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export function getWorkstreamMethod(this: MemoryAgentDatabase, workstreamId: string) {
    return Promise.resolve(this.projectWorkflow.getWorkstream(workstreamId));
}
