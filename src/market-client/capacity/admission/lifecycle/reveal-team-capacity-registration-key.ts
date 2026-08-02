import type { TeamCapacityRegistrationKeyReveal } from "../../../../capacity-provider/contracts/index.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function revealTeamCapacityRegistrationKeyMethod(this: MarketClient, teamId: string) {
    return this.request<{
        ok: true;
        payload: TeamCapacityRegistrationKeyReveal;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-registration-key/reveal`, { requireAuth: true });
}
