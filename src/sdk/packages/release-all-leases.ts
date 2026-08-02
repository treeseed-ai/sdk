import { AgentSdk } from "../../entrypoints/models/sdk.ts";
export async function releaseAllLeasesMethod(this: AgentSdk) {
    const count = await this.database.releaseAllLeases();
    return this.envelope('content_lease', 'update', { count });
}
