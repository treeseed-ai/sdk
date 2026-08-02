import { MarketClient,MarketWebAuthSession } from "../../../entrypoints/clients/market-client.ts";
export function webSignUpMethod(this: MarketClient, body: {
    email: string;
    password: string;
    username?: string | null;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
}) {
    return this.request<{
        ok: true;
        payload: MarketWebAuthSession;
    }>('/v1/auth/web/sign-up', {
        method: 'POST',
        body,
    });
}
