import { MarketClient,ProjectEnvironmentAccess,TeamAccessSummary } from "../../../../entrypoints/clients/market-client.ts";
export function projectAccessMethod(this: MarketClient, projectId: string) {
    return this.request<{
        ok: true;
        payload: {
            projectId: string;
            team: TeamAccessSummary;
            environments: ProjectEnvironmentAccess[];
        };
    }>(`/v1/projects/${encodeURIComponent(projectId)}/access`, { requireAuth: true });
}
