import { MemoryAgentDatabase } from "../../persistence/d1-store.ts";
export function listReleasesMethod(this: MemoryAgentDatabase, projectId: string) {
    return Promise.resolve(this.projectWorkflow.listReleases(projectId));
}
