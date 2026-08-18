import { MarketClient,MarketWebAuthSession } from "../../../entrypoints/clients/market-client.ts";
export function updateWebProfileMethod(this: MarketClient, body: {
    name?: string | null;
    image?: string | null;
}) {
    return this.request<{
        ok: true;
        payload: MarketWebAuthSession;
    }>('/v1/auth/web/profile', {
        method: 'PATCH',
        body,
        requireAuth: true,
    });
}
