import { MemoryAgentDatabase } from "../../persistence/d1-store.ts";
import type { SharePackageStatus } from "../../projects/projects-core/project-workflow.ts";
export function upsertSharePackageMethod(this: MemoryAgentDatabase, input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>) {
    return Promise.resolve(this.projectWorkflow.upsertSharePackage(input));
}
