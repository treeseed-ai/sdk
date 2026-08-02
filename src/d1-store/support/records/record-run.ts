import type { SdkRecordRunRequest,SdkRunEntity } from "../../../entrypoints/models/sdk-types.ts";
import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export async function recordRunMethod(this: MemoryAgentDatabase, request: SdkRecordRunRequest) {
    const run = request.run as SdkRunEntity;
    this.runs.set(String(run.runId), run);
    return run;
}
