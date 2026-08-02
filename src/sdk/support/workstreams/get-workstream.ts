import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
import type { WorkstreamDetail } from "../../../projects/projects-core/project-workflow.ts";
export async function getWorkstreamMethod(this: AgentSdk, workstreamId: string) {
    const payload = await this.database.getWorkstream(workstreamId);
    return this.envelope<WorkstreamDetail>('task', 'get', payload);
}
