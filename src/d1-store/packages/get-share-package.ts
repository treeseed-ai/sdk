import { MemoryAgentDatabase } from "../../persistence/d1-store.ts";
export function getSharePackageMethod(this: MemoryAgentDatabase, packageId: string) {
    return Promise.resolve(this.projectWorkflow.getSharePackage(packageId));
}
