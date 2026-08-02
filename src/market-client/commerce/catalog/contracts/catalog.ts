import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function catalogMethod(this: MarketClient, kind?: string | null) {
    const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    return this.request<{
        ok: true;
        payload: unknown[];
    }>(`/v1/catalog${query}`, { requireAuth: Boolean(this.accessToken) });
}
