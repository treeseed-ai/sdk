import type { ProviderTeamCredentialMetadata } from "../../../../capacity-provider/contracts/index.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function revokeCapacityProviderCredentialMethod(this: MarketClient, teamId: string, membershipId: string, credentialId: string, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: ProviderTeamCredentialMetadata;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-provider-memberships/${encodeURIComponent(membershipId)}/credentials/${encodeURIComponent(credentialId)}/revoke`, { method: 'POST', requireAuth: true, headers: { 'idempotency-key': idempotencyKey } });
}
