import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function transitionCapacityGrantMethod(this: MarketClient, teamId: string, grantId: string, action: 'activate' | 'pause' | 'resume' | 'revoke', idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-grants/${encodeURIComponent(grantId)}/${action}`, { method: 'POST', requireAuth: true, headers: { 'idempotency-key': idempotencyKey } });
}
