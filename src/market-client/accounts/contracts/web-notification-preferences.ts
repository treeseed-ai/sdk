import type { NotificationPreferences } from "../../../accounts/account-contracts.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function webNotificationPreferencesMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: NotificationPreferences;
    }>('/v1/auth/web/notifications/preferences', { requireAuth: true });
}
