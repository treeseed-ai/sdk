import { AgentSdk } from "../../entrypoints/models/sdk.ts";
import type { SharePackageStatus } from "../../projects/projects-core/project-workflow.ts";
export async function getSharePackageMethod(this: AgentSdk, packageId: string) {
    const payload = await this.database.getSharePackage(packageId);
    return this.envelope<SharePackageStatus>('report', 'get', payload);
}
