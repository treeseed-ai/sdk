import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityReservationsMethod(this: MarketClient, teamId: string, options: {
    projectId: string;
    workDayId?: string | null;
    limit?: number;
    cursor?: string | null;
}) {
    return this.capacityEvidencePage(teamId, 'reservations', options);
}
