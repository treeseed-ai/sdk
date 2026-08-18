import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function applySeedMethod(this: MarketClient, seedName: string, body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/v1/seeds/${encodeURIComponent(seedName)}/apply`, { method: 'POST', body, requireAuth: true });
}
