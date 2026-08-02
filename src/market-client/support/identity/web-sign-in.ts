import { MarketClient,MarketWebAuthSession } from "../../../entrypoints/clients/market-client.ts";
export function webSignInMethod(this: MarketClient, body: {
    email?: string;
    username?: string;
    login?: string;
    password: string;
}) {
    return this.request<{
        ok: true;
        payload: MarketWebAuthSession;
    }>('/v1/auth/web/sign-in', {
        method: 'POST',
        body,
    });
}
