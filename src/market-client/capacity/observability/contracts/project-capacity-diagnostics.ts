import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function projectCapacityDiagnosticsMethod(this: MarketClient, projectId: string, environment?: string | null) {
    const query = environment ? `?environment=${encodeURIComponent(environment)}` : '';
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/capacity-diagnostics${query}`, { requireAuth: true });
}
