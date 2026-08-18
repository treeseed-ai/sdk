import { MarketClient,MarketUserEmailAddress,MarketWebAuthSession } from "../../../entrypoints/clients/market-client.ts";
export function setPrimaryWebEmailMethod(this: MarketClient, emailId: string) {
    return this.request<{
        ok: true;
        payload: MarketWebAuthSession & {
            emailAddress: MarketUserEmailAddress;
        };
    }>(`/v1/auth/web/emails/${encodeURIComponent(emailId)}/primary`, { method: 'POST', requireAuth: true });
}
