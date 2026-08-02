import { MarketClient,MarketUserEmailAddress } from "../../../entrypoints/clients/market-client.ts";
export function verifyWebEmailMethod(this: MarketClient, emailId: string) {
    return this.request<{
        ok: true;
        payload: {
            emailAddress: MarketUserEmailAddress;
            verificationSent: boolean;
            confirmationToken?: string;
        };
    }>(`/v1/auth/web/emails/${encodeURIComponent(emailId)}/verify`, { method: 'POST', requireAuth: true });
}
