import { MemoryAgentDatabase } from "../../persistence/d1-store.ts";
export function listSharePackagesMethod(this: MemoryAgentDatabase, projectId: string) {
    return Promise.resolve(this.projectWorkflow.listSharePackages(projectId));
}
