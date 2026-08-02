import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function decideCapacityOverrunMethod(this: MarketClient, teamId: string, reservationId: string, decision: 'approve' | 'reject', body: {
    idempotencyKey: string;
}) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/reservations/${encodeURIComponent(reservationId)}/overrun/${decision}`, { method: 'POST', body, requireAuth: true });
}
