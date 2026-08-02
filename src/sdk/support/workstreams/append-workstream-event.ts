import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
import type { WorkstreamEvent } from "../../../projects/projects-core/project-workflow.ts";
export async function appendWorkstreamEventMethod(this: AgentSdk, input: Pick<WorkstreamEvent, 'projectId' | 'workstreamId' | 'kind'> & Partial<WorkstreamEvent>) {
    const payload = await this.database.appendWorkstreamEvent(input);
    return this.envelope<WorkstreamEvent>('workstream_event', 'create', payload);
}
