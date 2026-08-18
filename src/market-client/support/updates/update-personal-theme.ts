import type { PersonalTheme,PersonalThemeDraft } from "../../../accounts/account-contracts.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function updatePersonalThemeMethod(this: MarketClient, themeId: string, body: PersonalThemeDraft) {
    return this.request<{
        ok: true;
        payload: PersonalTheme;
    }>(`/v1/auth/web/themes/${encodeURIComponent(themeId)}`, { method: 'PATCH', body, requireAuth: true });
}
