import { MemoryAgentDatabase } from "../../persistence/d1-store.ts";
export async function releaseAllLeasesMethod(this: MemoryAgentDatabase) {
    const count = this.contentLeases.size;
    this.contentLeases.clear();
    return count;
}
