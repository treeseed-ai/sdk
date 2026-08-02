import type { ProviderCredentialIssuanceAuthorization } from "../../../../capacity-provider/contracts/index.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function authorizeCapacityProviderCredentialRotationMethod(this: MarketClient, teamId: string, membershipId: string, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: ProviderCredentialIssuanceAuthorization;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-provider-memberships/${encodeURIComponent(membershipId)}/credentials/rotate`, { method: 'POST', requireAuth: true, headers: { 'idempotency-key': idempotencyKey } });
}
