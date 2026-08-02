import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function planSeedMethod(this: MarketClient, seedName: string, body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/v1/seeds/${encodeURIComponent(seedName)}/plan`, { method: 'POST', body, requireAuth: true });
}
