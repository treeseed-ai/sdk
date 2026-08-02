import type { SdkGetCursorRequest } from "../../../entrypoints/models/sdk-types.ts";
import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export async function getCursorMethod(this: MemoryAgentDatabase, request: SdkGetCursorRequest) {
    return this.cursors.get(`${request.agentSlug}:${request.cursorKey}`) ?? null;
}
