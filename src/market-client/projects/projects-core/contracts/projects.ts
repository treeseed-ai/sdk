import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function projectsMethod(this: MarketClient, teamId?: string | null) {
    const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    return this.request<{
        ok: true;
        payload: unknown[];
    }>(`/v1/projects${query}`, { requireAuth: true });
}
