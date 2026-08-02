import { AgentSdk } from "../../entrypoints/models/sdk.ts";
import type { SharePackageStatus } from "../../projects/projects-core/project-workflow.ts";
export async function listSharePackagesMethod(this: AgentSdk, projectId: string) {
    const payload = await this.database.listSharePackages(projectId);
    return this.envelope<SharePackageStatus[]>('report', 'search', payload, { count: payload.length });
}
