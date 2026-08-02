import type { ProviderRegistrationRequest } from "../../../../capacity-provider/contracts/index.ts";
import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function reviewCapacityProviderRegistrationMethod(this: MarketClient, teamId: string, requestId: string, action: 'approve' | 'reject' | 'cancel', idempotencyKey: string, body: {
    reason?: string;
    teamAlias?: string;
} = {}) {
    return this.request<{
        ok: true;
        payload: ProviderRegistrationRequest;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-provider-requests/${encodeURIComponent(requestId)}/${action}`, { method: 'POST', body, requireAuth: true, headers: { 'idempotency-key': idempotencyKey } });
}
