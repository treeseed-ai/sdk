import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityReservationExplanationMethod(this: MarketClient, teamId: string, reservationId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/reservations/${encodeURIComponent(reservationId)}/explanation`, { requireAuth: true });
}
