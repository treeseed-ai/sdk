import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function completeWebPasswordResetMethod(this: MarketClient, body: {
    token: string;
    password: string;
}) {
    return this.request<{
        ok: true;
        payload: {
            reset: true;
        };
    }>('/v1/auth/web/password-reset/complete', {
        method: 'POST',
        body,
    });
}
