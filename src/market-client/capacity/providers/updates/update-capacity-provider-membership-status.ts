import type { ProviderTeamMembership } from "../../../../capacity-provider/contracts/index.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function updateCapacityProviderMembershipStatusMethod(this: MarketClient, teamId: string, membershipId: string, action: 'suspend' | 'resume' | 'revoke', idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: ProviderTeamMembership;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-provider-memberships/${encodeURIComponent(membershipId)}/${action}`, { method: 'POST', requireAuth: true, headers: { 'idempotency-key': idempotencyKey } });
}
