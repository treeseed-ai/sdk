import type { ProviderTeamMembership } from "../../../../capacity-provider/contracts/index.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityProviderMembershipMethod(this: MarketClient, teamId: string, membershipId: string) {
    return this.request<{
        ok: true;
        payload: ProviderTeamMembership;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-provider-memberships/${encodeURIComponent(membershipId)}`, { requireAuth: true });
}
