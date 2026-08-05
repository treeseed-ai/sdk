import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function webAppearanceMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: {
            scheme: string;
            mode: string;
            workspace: { enabled: boolean; scheme: string; mode: 'inherit' | 'light' | 'dark' | 'system' };
        };
    }>('/v1/auth/web/appearance', { requireAuth: true });
}
