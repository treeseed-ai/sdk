import type { SdkGetCursorRequest } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function getCursorMethod(this: AgentSdk, request: SdkGetCursorRequest) {
    const payload = await this.database.getCursor(request);
    return this.envelope('agent_cursor', 'get', payload);
}
