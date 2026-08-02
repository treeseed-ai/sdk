import { MarketClient,MarketWebAuthSession } from "../../../entrypoints/clients/market-client.ts";
export function confirmWebEmailMethod(this: MarketClient, body: {
    token: string;
}) {
    return this.request<{
        ok: true;
        payload: MarketWebAuthSession;
    }>('/v1/auth/web/confirm-email', {
        method: 'POST',
        body,
    });
}
