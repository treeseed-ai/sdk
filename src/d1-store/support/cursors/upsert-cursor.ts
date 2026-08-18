import type { SdkCursorRequest } from "../../../entrypoints/models/sdk-types.ts";
import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export async function upsertCursorMethod(this: MemoryAgentDatabase, request: SdkCursorRequest) {
    this.cursors.set(`${request.agentSlug}:${request.cursorKey}`, request.cursorValue);
}
