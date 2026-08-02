import type { AccountNotification } from "../../../accounts/account-contracts.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function webNotificationsMethod(this: MarketClient, limit = 20) {
    return this.request<{
        ok: true;
        payload: AccountNotification[];
    }>(`/v1/auth/web/notifications?limit=${encodeURIComponent(String(limit))}`, { requireAuth: true });
}
