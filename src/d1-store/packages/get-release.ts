import { MemoryAgentDatabase } from "../../persistence/d1-store.ts";
export function getReleaseMethod(this: MemoryAgentDatabase, releaseId: string) {
    return Promise.resolve(this.projectWorkflow.getRelease(releaseId));
}
