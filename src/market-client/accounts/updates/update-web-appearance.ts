import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function updateWebAppearanceMethod(this: MarketClient, body: {
    colorScheme?: string | null;
    scheme?: string | null;
    themeMode?: string | null;
    mode?: string | null;
    contentThemeOverlayEnabled?: boolean | null;
    contentThemeOverlayScheme?: string | null;
    contentThemeOverlayMode?: 'inherit' | 'light' | 'dark' | 'system' | null;
}) {
    return this.request<{
        ok: true;
        payload: {
            scheme: string;
            mode: string;
            workspace: { enabled: boolean; scheme: string; mode: 'inherit' | 'light' | 'dark' | 'system' };
        };
    }>('/v1/auth/web/appearance', {
        method: 'PATCH',
        body,
        requireAuth: true,
    });
}
