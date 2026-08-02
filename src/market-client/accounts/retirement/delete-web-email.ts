import { MarketClient,MarketUserEmailAddress } from "../../../entrypoints/clients/market-client.ts";
export function deleteWebEmailMethod(this: MarketClient, emailId: string) {
    return this.request<{
        ok: true;
        payload: MarketUserEmailAddress[];
    }>(`/v1/auth/web/emails/${encodeURIComponent(emailId)}`, { method: 'DELETE', requireAuth: true });
}
