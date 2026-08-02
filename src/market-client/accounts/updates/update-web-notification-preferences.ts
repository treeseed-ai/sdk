import type { NotificationPreferences } from "../../../accounts/account-contracts.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function updateWebNotificationPreferencesMethod(this: MarketClient, body: NotificationPreferences) {
    return this.request<{
        ok: true;
        payload: NotificationPreferences;
    }>('/v1/auth/web/notifications/preferences', { method: 'PUT', body, requireAuth: true });
}
