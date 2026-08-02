import type { PersonalTheme,PersonalThemeDraft } from "../../../accounts/account-contracts.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function createPersonalThemeMethod(this: MarketClient, body: PersonalThemeDraft) {
    return this.request<{
        ok: true;
        payload: PersonalTheme;
    }>('/v1/auth/web/themes', { method: 'POST', body, requireAuth: true });
}
