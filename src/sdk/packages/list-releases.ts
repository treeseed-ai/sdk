import { AgentSdk } from "../../entrypoints/models/sdk.ts";
import type { ReleaseSummary } from "../../projects/projects-core/project-workflow.ts";
export async function listReleasesMethod(this: AgentSdk, projectId: string) {
    const payload = await this.database.listReleases(projectId);
    return this.envelope<ReleaseSummary[]>('report', 'search', payload, { count: payload.length });
}
