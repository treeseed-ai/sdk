import type { SdkRecordRunRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function recordRunMethod(this: AgentSdk, request: SdkRecordRunRequest) {
    const payload = await this.database.recordRun(request);
    return this.envelope('agent_run', 'update', payload);
}
