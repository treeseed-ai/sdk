import { MarketClient,MarketUserEmailAddress } from "../../../entrypoints/clients/market-client.ts";
export function webEmailsMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: MarketUserEmailAddress[];
    }>('/v1/auth/web/emails', { requireAuth: true });
}
