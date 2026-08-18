import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function createTeamMethod(this: MarketClient, body: {
    name: string;
    displayName?: string;
    metadata?: Record<string, unknown>;
}) {
    return this.request<{
        ok: true;
        payload: {
            id: string;
            name: string;
            displayName?: string;
        };
    }>('/v1/teams', {
        method: 'POST',
        body,
        requireAuth: true,
    });
}
