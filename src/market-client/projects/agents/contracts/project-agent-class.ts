import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function projectAgentClassMethod(this: MarketClient, projectId: string, classId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/agent-classes/${encodeURIComponent(classId)}`, { requireAuth: true });
}
