import { MemoryAgentDatabase } from "../../../persistence/d1-store.ts";
export function inspectLeasesMethod(this: MemoryAgentDatabase) {
    return [...this.contentLeases.values()];
}
