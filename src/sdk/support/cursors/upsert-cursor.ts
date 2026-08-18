import type { SdkCursorRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function upsertCursorMethod(this: AgentSdk, request: SdkCursorRequest) {
    await this.database.upsertCursor(request);
    return this.envelope('agent_cursor', 'update', request);
}
