import type { CapacityRuntimeDiagnosticsResponse } from "../../../../capacity/agents/agent-capacity.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function projectCapacityRuntimeDiagnosticsMethod(this: MarketClient, projectId: string, teamId: string) {
    const query = new URLSearchParams({ teamId });
    return this.request<{
        ok: true;
        payload: CapacityRuntimeDiagnosticsResponse;
    }>(`/v1/projects/${encodeURIComponent(projectId)}/capacity-runtime-diagnostics?${query.toString()}`, { requireAuth: true });
}
