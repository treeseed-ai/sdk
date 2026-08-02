import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function deletePersonalThemeMethod(this: MarketClient, themeId: string) {
    return this.request<{
        ok: true;
        payload: {
            id: string;
            deleted: true;
        };
    }>(`/v1/auth/web/themes/${encodeURIComponent(themeId)}`, { method: 'DELETE', requireAuth: true });
}
