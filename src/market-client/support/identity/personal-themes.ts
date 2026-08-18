import type { PersonalTheme } from "../../../accounts/account-contracts.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function personalThemesMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: PersonalTheme[];
    }>('/v1/auth/web/themes', { requireAuth: true });
}
