import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
import type { ProjectRepositoryTopology } from "../../../../entrypoints/models/sdk-types.ts";
export function projectRepositoryTopologyMethod(this: MarketClient, projectId: string) {
    return this.request<{
        ok: true;
        payload: ProjectRepositoryTopology;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/repository-topology`, { requireAuth: true });
}
