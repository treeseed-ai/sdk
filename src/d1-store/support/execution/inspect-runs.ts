import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export function inspectRunsMethod(this: MemoryAgentDatabase) {
    return [...this.runs.values()];
}
