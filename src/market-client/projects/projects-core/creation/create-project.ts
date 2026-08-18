import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function createProjectMethod(this: MarketClient, teamId: string, body: {
    id?: string;
    slug: string;
    name: string;
    description?: string;
    metadata?: Record<string, unknown>;
}) {
    return this.request<{
        ok: true;
        payload: {
            project?: {
                id: string;
                slug: string;
                teamId: string;
            };
            id?: string;
            slug?: string;
            teamId?: string;
        };
    }>(`/v1/teams/${encodeURIComponent(teamId)}/projects`, { method: 'POST', body, requireAuth: true });
}
