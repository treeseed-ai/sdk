import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function requestWebPasswordResetMethod(this: MarketClient, body: {
    email: string;
}) {
    return this.request<{
        ok: true;
        payload: {
            sent: true;
            resetToken?: string | null;
        };
    }>('/v1/auth/web/password-reset/request', {
        method: 'POST',
        body,
    });
}
