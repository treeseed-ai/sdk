import type { TeamCapacityRegistrationKeyMetadata } from "../../../../capacity-provider/contracts/index.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function teamCapacityRegistrationKeyMethod(this: MarketClient, teamId: string) {
    return this.request<{
        ok: true;
        payload: TeamCapacityRegistrationKeyMetadata;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-registration-key`, { requireAuth: true });
}
