import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function treeDxReadRepositoryFilesMethod(this: MarketClient, projectId: string, repoId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return this.request<{
        ok: true;
        payload: unknown;
    }>(`/v1/dx/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repoId)}/files/read`, { method: 'POST', body, headers, requireAuth: true });
}
