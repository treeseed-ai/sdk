import { AgentSdk } from "../../entrypoints/models/sdk.ts";
import type { ReleaseDetail,ReleaseSummary } from "../../projects/projects-core/project-workflow.ts";
export async function upsertReleaseMethod(this: AgentSdk, input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & {
    items?: ReleaseDetail['items'];
}) {
    const payload = await this.database.upsertRelease(input);
    return this.envelope<ReleaseDetail>('report', 'update', payload);
}
