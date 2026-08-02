import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function updateWebAppearanceMethod(this: MarketClient, body: {
    colorScheme?: string | null;
    scheme?: string | null;
    themeMode?: string | null;
    mode?: string | null;
}) {
    return this.request<{
        ok: true;
        payload: {
            scheme: string;
            mode: string;
        };
    }>('/v1/auth/web/appearance', {
        method: 'PATCH',
        body,
        requireAuth: true,
    });
}
