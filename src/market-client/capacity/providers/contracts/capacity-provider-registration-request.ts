import type { ProviderRegistrationRequest } from "../../../../capacity-provider/contracts/index.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityProviderRegistrationRequestMethod(this: MarketClient, teamId: string, requestId: string) {
    return this.request<{
        ok: true;
        payload: ProviderRegistrationRequest;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-provider-requests/${encodeURIComponent(requestId)}`, { requireAuth: true });
}
