import { MemoryAgentDatabase } from "../../persistence/d1-store.ts";
import type { ReleaseDetail,ReleaseSummary } from "../../projects/projects-core/project-workflow.ts";
export function upsertReleaseMethod(this: MemoryAgentDatabase, input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & {
    items?: ReleaseDetail['items'];
}): Promise<ReleaseDetail | null> {
    return Promise.resolve(this.projectWorkflow.upsertRelease(input));
}
