import { AgentSdk } from "../../entrypoints/models/sdk.ts";
import type { ReleaseDetail } from "../../projects/projects-core/project-workflow.ts";
export async function getReleaseMethod(this: AgentSdk, releaseId: string) {
    const payload = await this.database.getRelease(releaseId);
    return this.envelope<ReleaseDetail>('report', 'get', payload);
}
