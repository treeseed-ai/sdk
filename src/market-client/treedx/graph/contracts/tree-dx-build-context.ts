import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function treeDxBuildContextMethod(this: MarketClient, projectId: string, repoId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return this.request<{
        ok: true;
        payload: unknown;
    }>(`/v1/dx/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repoId)}/context/build`, { method: 'POST', body, headers, requireAuth: true });
}
