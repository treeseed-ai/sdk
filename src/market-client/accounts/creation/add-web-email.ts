import { MarketClient,MarketUserEmailAddress } from "../../../entrypoints/clients/market-client.ts";
export function addWebEmailMethod(this: MarketClient, body: {
    email: string;
}) {
    return this.request<{
        ok: true;
        payload: {
            emailAddress: MarketUserEmailAddress;
            verificationSent: boolean;
            confirmationToken?: string;
        };
    }>('/v1/auth/web/emails', {
        method: 'POST',
        body,
        requireAuth: true,
    });
}
