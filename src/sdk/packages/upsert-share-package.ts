import { AgentSdk } from "../../entrypoints/models/sdk.ts";
import type { SharePackageStatus } from "../../projects/projects-core/project-workflow.ts";
export async function upsertSharePackageMethod(this: AgentSdk, input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>) {
    const payload = await this.database.upsertSharePackage(input);
    return this.envelope<SharePackageStatus>('report', 'update', payload);
}
