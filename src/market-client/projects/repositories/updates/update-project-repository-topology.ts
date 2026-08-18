import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
import type { ProjectRepositoryTopology } from "../../../../entrypoints/models/sdk-types.ts";
export function updateProjectRepositoryTopologyMethod(this: MarketClient, projectId: string, body: ProjectRepositoryTopology | Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: ProjectRepositoryTopology;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/repository-topology`, { method: 'PUT', body, requireAuth: true });
}
